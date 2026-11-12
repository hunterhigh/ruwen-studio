import { createHash } from "node:crypto";
import path from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import {
  applyEditorialEdits,
  applySectionEdits,
  assertInputLimits,
  checks,
  type EditorialEdit,
  handoff,
  type SectionEdit,
  state,
} from "@ruwen/core";
import {
  editingPolicy,
  ROLE_OUTPUT_ATTEMPTS,
  roleGenerationPolicy,
} from "./models.ts";
import { assemblePrompt } from "./prompts/manifest.ts";
import { ideationRoleSpec } from "./roles/expression-phase.ts";
import { ROLES } from "./roles/index.ts";
import { publicTemplateMaterials } from "./security/public-templates.ts";
import {
  CONTENT_REFUSAL,
  INTERNAL_REFUSAL,
  RoleSecurity,
  SECURITY_ROLE_FAILURE,
} from "./security/role-security.ts";
import {
  listAuthorizedResources,
  readAuthorizedResource,
  roleTools,
} from "./tools/index.ts";
import {
  anchorCorrection,
  editorAnchorIssues,
  ProseAnchorError,
  ReaderCoverageError,
  readerReactions,
} from "./tools/prose-anchors.ts";
import {
  toolValidationMessage,
  toolValidator,
} from "./tools/validation-feedback.ts";
import {
  type AttemptResetReason,
  type Data,
  RoleAbortError,
  type RoleContext,
  RoleExecutionError,
  type RoleId,
  RoleOutputError,
  RoleProviderError,
  type RoleResult,
  RoleSecurityError,
  RoleTimeoutError,
  type RoleTool,
  RoleTruncatedError,
  RoleTurnLimitError,
} from "./types.ts";

const object = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);
async function prepareInput(
  id: RoleId,
  input: Data,
  ctx: RoleContext,
): Promise<Data> {
  const safe: Data = { ...input };
  for (const key of ["resources", "approved_resources"])
    if (
      ["zhangjie-qingjing-bianyiyuan", "biaoxian-shejishi"].includes(id) &&
      Array.isArray(safe[key])
    ) {
      const records: Data[] = [];
      for (const record of safe[key]) {
        if (!object(record) || typeof record.id !== "string")
          throw new RoleOutputError(
            "Resource inputs must refer to registered IDs",
          );
        records.push(await readAuthorizedResource(ctx, id, record.id));
      }
      safe[key] = records;
    }
  if (
    id === "xiaoshuo-zuozhe" &&
    (typeof safe.packet !== "string" ||
      !safe.packet.trim() ||
      Array.from(safe.packet).length > 8000)
  )
    throw new RoleOutputError("Invalid bounded author packet");
  if (
    [
      "qinggan-duzhe",
      "wenxue-bianji",
      "qingjie-heyanyuan",
      "xianshi-heyanyuan",
    ].includes(id) &&
    (typeof safe.prose !== "string" || !safe.prose.trim())
  )
    throw new RoleOutputError("Role requires current prose");
  if (
    id === "jiyi-weihuyuan" &&
    (typeof safe.approved_prose !== "string" || !safe.approved_prose.trim())
  )
    throw new RoleOutputError("Memory role requires approved prose");
  if (id === "jiyi-weihuyuan") {
    if (
      [
        "candidate",
        "candidate_prose",
        "unapproved_prose",
        "candidate_inferences",
        "unapproved_inferences",
      ].some((key) => Object.hasOwn(input, key))
    )
      throw new RoleOutputError(
        "Unapproved candidate or inference cannot enter memory input",
      );
    const resources = await listAuthorizedResources(ctx, id);
    const supplied = Array.isArray(input.resources) ? input.resources : [];
    safe.resources = supplied.map((record) => {
      if (!object(record) || typeof record.id !== "string")
        throw new RoleOutputError(
          "Memory inputs require registered resource IDs",
        );
      const resource = resources.find((resource) => resource.id === record.id);
      if (!resource)
        throw new RoleOutputError("Memory metadata resource is not authorized");
      return {
        id: resource.id,
        path: resource.path,
        type: resource.type,
        scope: resource.scope,
        sha256: resource.source_sha256,
      };
    });
    const current = await state.loadState(ctx.fs);
    const approved = current.last_approved_prose;
    if (
      !current.pending_consolidation ||
      !object(approved) ||
      typeof approved.path !== "string" ||
      !ctx.fs.path(approved.path).startsWith("chapters/") ||
      (await state.currentRefReason(ctx.fs, approved, "approved prose"))
    )
      throw new RoleOutputError(
        "Memory role can run only after an approved chapter is promoted",
      );
    const canonical = (await ctx.fs.readText(approved.path)).replace(
      /\r\n?/g,
      "\n",
    );
    if (
      typeof safe.approved_prose !== "string" ||
      safe.approved_prose.replace(/\r\n?/g, "\n") !== canonical
    )
      throw new RoleOutputError("Memory input is not the approved chapter");
  }
  return safe;
}
async function validateOutput(
  id: RoleId,
  output: Data,
  input: Data,
  readBodies: Map<string, Data>,
): Promise<void> {
  if (id === "chuangyi-xietiaoyuan") {
    const errors = await handoff.validateHandoff(
      output,
      typeof input.raw_user_text === "string"
        ? { rawSource: input.raw_user_text }
        : {},
    );
    if (errors.length) throw new RoleOutputError(errors.join("；"));
  }
  if (id === "wenxue-bianji") {
    if (!Array.isArray(output.edits) || !Array.isArray(output.problems))
      throw new RoleOutputError(
        "Editor requires anchored edits and problem records",
      );
    const issues = editorAnchorIssues(output, String(input.prose));
    if (issues.length)
      throw new ProseAnchorError(
        issues,
        "Edit anchor not found or is not unique",
      );
    if (
      output.decision !== "LOCAL_EDIT" &&
      (typeof output.return_reason !== "string" ||
        !output.return_reason.trim() ||
        output.edits.length !== 0)
    )
      throw new RoleOutputError(
        "Returned edits require a reason and cannot silently rewrite prose",
      );
    applyEditorialEdits(
      String(input.prose),
      output.edits as unknown as EditorialEdit[],
      editingPolicy(),
    );
    for (const problem of output.problems) {
      if (
        !object(problem) ||
        !["location", "category", "condition", "handling", "result"].every(
          (key) =>
            typeof problem[key] === "string" && String(problem[key]).trim(),
        )
      )
        throw new RoleOutputError(
          "Literary problem fields must be nonempty text",
        );
      if (!String(input.prose).includes(String(problem.location)))
        throw new RoleOutputError(
          "Literary problem location must quote the original prose",
        );
    }
  }
  if (id === "jiyi-weihuyuan" && Array.isArray(output.patches)) {
    const seen = new Set<string>();
    for (const patch of output.patches) {
      if (!object(patch) || typeof patch.path !== "string")
        throw new RoleOutputError("Invalid memory patch");
      const read = readBodies.get(patch.path);
      if (!read || read.sha256 !== patch.base_sha256)
        throw new RoleOutputError(
          "Memory resource was not read in this role run or hash differs",
        );
      if (seen.has(patch.path))
        throw new RoleOutputError("Duplicate memory patch path");
      seen.add(patch.path);
      applySectionEdits(
        String(read.content),
        patch.sections as unknown as SectionEdit[],
        editingPolicy(),
      );
    }
  }
  if (["qingjie-heyanyuan", "xianshi-heyanyuan"].includes(id)) {
    if (
      !Array.isArray(output.issues) ||
      (output.pass === true
        ? output.issues.length > 0
        : output.issues.length === 0)
    )
      throw new RoleOutputError("Verdict and issues disagree");
    for (const issue of output.issues.filter(object)) {
      if (
        id === "qingjie-heyanyuan" &&
        ![
          ...(Array.isArray(input.locked_events) ? input.locked_events : []),
          ...(Array.isArray(input.locked_order) ? input.locked_order : []),
        ].some((value) => value === issue.promise)
      )
        throw new RoleOutputError(
          "Plot issue must refer to a supplied commitment",
        );
      if (
        id === "xianshi-heyanyuan" &&
        Array.isArray(input.hard_rules) &&
        !input.hard_rules
          .filter(object)
          .some(
            (rule) =>
              rule.id === issue.rule_ref || rule.path === issue.rule_ref,
          )
      )
        throw new RoleOutputError(
          "Reality issue must refer to a supplied hard rule",
        );
    }
  }
  if (id === "zhangjie-qingjing-bianyiyuan") {
    const errors = checks.projectionErrors(String(output.generation_field));
    if (errors.length) throw new RoleOutputError(errors.join("；"));
    for (const key of ["locked_events", "locked_order"]) {
      const allowed = Array.isArray(input[key]) ? input[key] : [];
      if (
        !Array.isArray(output[key]) ||
        output[key].some((v) => !allowed.includes(v))
      )
        throw new RoleOutputError("Compiler cannot invent locked commitments");
    }
  }
}
export async function runRole(
  id: RoleId,
  rawInput: Data,
  context: RoleContext,
): Promise<RoleResult> {
  const reads = new Map<string, { id: string; path: string; sha256: string }>();
  const readBodies = new Map<string, Data>();
  const ctx: RoleContext = {
    ...context,
    onResourceRead: (resource, role) => {
      readBodies.set(String(resource.path), resource);
      reads.set(String(resource.path), {
        id: String(resource.id),
        path: String(resource.path),
        sha256: String(resource.sha256),
      });
      context.onResourceRead?.(resource, role);
    },
  };
  if (!Object.hasOwn(ROLES, id)) throw new RoleOutputError("Unknown role");
  if (ctx.runtime.privateStorageRoot) {
    const relative = path.relative(
      path.resolve(ctx.fs.root),
      path.resolve(ctx.runtime.privateStorageRoot),
    );
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative)))
      throw new RoleOutputError(
        "Private recording storage must remain outside the user project",
      );
  }
  if (ctx.signal?.aborted)
    throw new RoleAbortError("Role cancelled before start");
  const spec = ideationRoleSpec(id, ctx.ideationPhase);
  assertInputLimits(rawInput);
  const submitName =
    spec.output.kind === "tool" ? spec.output.toolName : undefined;
  const input = await prepareInput(id, rawInput, ctx);
  const user = spec.buildUserMessage(input);
  const prompt = await assemblePrompt(spec, ctx.upstreamRoot);
  await ctx.onPrompt?.(prompt);
  const security = new RoleSecurity(
    prompt.content,
    user,
    spec.output.kind === "tool" && id !== "chuangyi-xietiaoyuan",
    await publicTemplateMaterials(ctx.upstreamRoot),
    (text) => ctx.onDelta?.(text, id),
  );
  const { model, thinkingLevel } = ctx.runtime.resolve(spec);
  const maxTokens = ctx.maxTokens ?? roleGenerationPolicy(id).maxTokens;
  if (
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    (["xiaoshuo-zuozhe", "wenxue-bianji"].includes(id) && maxTokens < 32768) ||
    maxTokens > model.maxTokens
  )
    throw new RoleOutputError(
      "Role output cap exceeds model limit or is invalid",
    );
  const usage: Usage[] = [];
  const started = performance.now();
  const tools = roleTools(id, ctx);
  for (const tool of tools) {
    if (!["read_resource", "list_resources", "web_search"].includes(tool.name))
      continue;
    const execute = tool.execute;
    tool.execute = async (...args) => {
      const result = await execute(...args);
      ctx.onToolMaterial?.(result.details, id);
      security.detector.addMaterial(result);
      return result;
    };
  }
  let output: Data | string | undefined;
  let submitted = false;
  let turns = 0;
  let limitReached = false;
  let timedOut = false;
  let lastValidationError: string | undefined;
  let anchorError: ProseAnchorError | undefined;
  let attemptNumber = 0;
  let finalOutputAttempt = false;
  let droppedReactions: Data[] | undefined;
  let adjustedReactions: Data[] | undefined;
  const failures: NonNullable<RoleResult["failures"]> = [];
  const recordFailure = (error: string) => {
    if (!failures.some((f) => f.attempt === attemptNumber && f.error === error))
      failures.push({ role: id, attempt: attemptNumber, error });
  };
  let inFlight = false;
  let generated = false;
  const maxTurns = Math.max(
    1,
    Math.min(spec.maxTurns, ctx.maxTurns ?? spec.maxTurns),
  );
  if (spec.output.kind === "tool") {
    const format = spec.output;
    const submit: RoleTool = {
      name: format.toolName,
      label: "提交岗位结果",
      description: "提交最终结构化结果并结束本岗位。",
      parameters: format.schema,
      async execute(_call, value) {
        if (security.inspect(value))
          throw new RoleSecurityError(SECURITY_ROLE_FAILURE);
        try {
          if (id === "qinggan-duzhe")
            value = readerReactions(
              value,
              String(input.prose),
              finalOutputAttempt,
            );
          await validateOutput(id, value, input, readBodies);
        } catch (error) {
          lastValidationError = (error as Error).message;
          anchorError = error instanceof ProseAnchorError ? error : undefined;
          if (error instanceof ReaderCoverageError && finalOutputAttempt) {
            droppedReactions = error.dropped_reactions;
            adjustedReactions = error.anchor_adjusted;
          }
          recordFailure(lastValidationError);
          throw error;
        }
        output = structuredClone(value);
        submitted = true;
        return {
          content: [{ type: "text", text: "已提交" }],
          details: {},
          structuredContent: value,
          terminate: true,
        };
      },
    };
    tools.push(submit);
  }
  const validators = new Map(
    tools.map((tool) => [tool.name, toolValidator(tool.parameters)]),
  );
  const runtime = new Agent({
    sessionId: createHash("sha256")
      .update(`${ctx.fs.root}\0${ctx.projectKey}\0${id}\0${prompt.sha256}`)
      .digest("hex"),
    initialState: {
      model,
      thinkingLevel,
      systemPrompt: prompt.content,
      tools,
      messages: [],
    },
    toolExecution: "sequential",
    streamFn: (selected, context, options) => {
      inFlight = true;
      generated = false;
      ctx.onRequest?.(structuredClone(context), id);
      return ctx.runtime.models.streamSimple(selected, context, {
        ...options,
        cacheRetention: "long",
        maxTokens,
        maxRetries: 0,
      });
    },
    getApiKey: (provider) => ctx.runtime.apiKey?.(provider),
    ...(ctx.loadCoordinatorInput || ctx.beforeProviderRequest
      ? {
          prepareRequest: async ({ context }) => {
            await ctx.beforeProviderRequest?.();
            if (!ctx.loadCoordinatorInput) return undefined;
            if (id !== "chuangyi-xietiaoyuan")
              throw new RoleOutputError(
                "Conversation reload is coordinator-only",
              );
            const fresh = await ctx.loadCoordinatorInput?.();
            if (!fresh)
              throw new RoleOutputError("Coordinator context is unavailable");
            assertInputLimits(fresh);
            const current = await prepareInput(id, fresh, ctx);
            Object.assign(input, current);
            security.detector.addMaterial(current);
            const first = context.messages.findIndex(
              (message) => message.role === "user",
            );
            return {
              context: {
                ...context,
                messages: context.messages.map((message, index) =>
                  index === first && message.role === "user"
                    ? { ...message, content: spec.buildUserMessage(current) }
                    : message,
                ),
              },
            };
          },
        }
      : {}),
    beforeToolCall: async ({ toolCall, assistantMessage }, signal) => {
      security.observe(assistantMessage);
      if (security.failure || security.streamFailure)
        return { block: true, terminate: true, reason: "security_boundary" };
      if (assistantMessage.stopReason === "length")
        return { block: true, terminate: true, reason: "role_truncated" };
      if (signal?.aborted || submitted)
        return {
          block: true,
          terminate: true,
          reason: "role_already_finished",
        };
      const validator = validators.get(toolCall.name);
      if (!validator)
        return {
          block: true,
          terminate: true,
          reason: "strict_schema_required",
        };
      if (!validator.check(toolCall.arguments))
        return {
          block: true,
          terminate: true,
          reason: toolValidationMessage({
            tool: toolCall.name,
            issues: validator.issues(toolCall.arguments),
          }),
        };
      return undefined;
    },
    finishTurn: (turn) => {
      turns++;
      if (security.failure || security.streamFailure) return { action: "end" };
      if (turn.message.stopReason === "length") return { action: "end" };
      if (submitted) return { action: "end" };
      if (
        submitName &&
        turn.toolResults.some(
          (result) => result.toolName === submitName && result.isError,
        )
      )
        return { action: "end" };
      if (turns >= maxTurns) {
        limitReached = true;
        return { action: "end" };
      }
    },
  });
  runtime.subscribe((event) => {
    if (event.type === "message_end" && event.message.role === "assistant") {
      if (!["error", "aborted"].includes(event.message.stopReason))
        inFlight = false;
      else if (
        event.message.content.some((block) =>
          block.type === "text"
            ? !!block.text
            : block.type === "thinking"
              ? !!(block.thinking || block.thinkingSignature || block.redacted)
              : true,
        )
      )
        generated = true;
      if (!["error", "aborted"].includes(event.message.stopReason) || generated)
        usage.push(structuredClone(event.message.usage));
      security.observe(event.message);
      for (const block of event.message.content) {
        if (block.type !== "toolCall") continue;
        const validator = validators.get(block.name);
        if (!validator || validator.check(block.arguments)) continue;
        const failure = {
          tool: block.name,
          issues: validator.issues(block.arguments),
        };
        lastValidationError = toolValidationMessage(failure);
        recordFailure(lastValidationError);
        ctx.runtime.onToolValidationError?.(id, failure);
      }
    }
    if (event.type === "message_update") {
      const delta = event.assistantMessageEvent;
      if (
        "partial" in delta &&
        delta.partial.content.some(
          (block) =>
            block.type === "thinking" &&
            !!(block.thinkingSignature || block.redacted),
        )
      )
        generated = true;
      if (
        ["text_delta", "thinking_delta", "toolcall_delta"].includes(
          delta.type,
        ) &&
        "delta" in delta &&
        delta.delta
      )
        generated = true;
    }
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    )
      security.delta(event.assistantMessageEvent.delta);
  });
  let rejectAbort: ((reason: Error) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    runtime.abort();
    rejectAbort?.(
      timedOut
        ? new RoleTimeoutError("Role timed out")
        : new RoleAbortError("Role cancelled"),
    );
  };
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, ctx.timeoutMs ?? roleGenerationPolicy(id).timeoutMs);
  ctx.signal?.addEventListener("abort", abort, { once: true });
  const redact = (value: string) => {
    const key = ctx.runtime.apiKey?.(model.provider);
    return key ? value.split(key).join("[REDACTED]") : value;
  };
  const snapshot = (): RoleResult => {
    security.finalizeFailure();
    return {
      usageUnknown: inFlight && generated,
      runtimeMode: ctx.runtime.mode,
      output: output ?? "",
      usage: structuredClone(usage),
      costTotal: usage.reduce((total, item) => total + item.cost.total, 0),
      promptSha256: prompt.sha256,
      transcript: security.transcript(
        JSON.parse(redact(JSON.stringify(runtime.state.messages))),
      ) as RoleResult["transcript"],
      model: `${model.provider}/${model.id}`,
      durationMs: performance.now() - started,
      readResources: [...reads.values()],
      securityEvents: structuredClone(security.events),
      ...(adjustedReactions?.length && !security.failure
        ? { anchor_adjusted: structuredClone(adjustedReactions) }
        : {}),
      ...(droppedReactions?.length && !security.failure
        ? { dropped_reactions: structuredClone(droppedReactions) }
        : {}),
      ...(failures.length
        ? {
            failures: failures.map((f) => ({
              ...f,
              error: security.failure ? SECURITY_ROLE_FAILURE : redact(f.error),
            })),
          }
        : {}),
    };
  };
  const complete = () => {
    if (security.inspect(output))
      throw new RoleSecurityError(SECURITY_ROLE_FAILURE);
    const result = snapshot();
    security.publish();
    return result;
  };
  try {
    let overlapRetried = false;
    let prompted = false;
    const formatCorrection =
      "上次输出未通过格式或内容校验。请依据当前岗位的输入与输出契约重新提交，只输出合法结果。";
    let correction = formatCorrection;
    let resetReason: AttemptResetReason = "format_correction";
    for (let attempt = 0; attempt < ROLE_OUTPUT_ATTEMPTS; attempt++) {
      attemptNumber++;
      finalOutputAttempt = attempt === ROLE_OUTPUT_ATTEMPTS - 1;
      lastValidationError = undefined;
      anchorError = undefined;
      const attemptStart = runtime.state.messages.length;
      if (ctx.signal?.aborted) throw new RoleAbortError("Role cancelled");
      if (prompted) {
        ctx.onAttemptReset?.(id, resetReason);
        // Drop the abandoned withheld suffix as well as resetting the consumer display.
        // Already published text remains scanner context so reset cannot bypass security.
        security.retry(resetReason === "prompt_overlap_correction");
      }
      const nextPrompt = prompted ? correction : user;
      prompted = true;
      await Promise.race([runtime.prompt(nextPrompt), aborted]);
      const message = [...runtime.state.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (security.streamFailure)
        throw new RoleOutputError(security.streamFailure);
      if (security.failure) {
        recordFailure(SECURITY_ROLE_FAILURE);
        output = "";
        if (id === "chuangyi-xietiaoyuan") {
          ctx.onAttemptReset?.(id, "security_refusal");
          output = INTERNAL_REFUSAL;
          const result = snapshot();
          ctx.onDelta?.(INTERNAL_REFUSAL, id);
          return result;
        }
        if (
          security.failure === "prompt_overlap" &&
          spec.output.kind === "tool" &&
          !overlapRetried
        ) {
          overlapRetried = true;
          resetReason = "prompt_overlap_correction";
          correction =
            "上次输出逐字引用了平台规则。请用自己的话表述，不要逐字引用平台规则；依据当前岗位的输入与输出契约重新提交合法结果。";
          // Never feed rejected excerpts back into provider history or grant them an exemption.
          const failedAssistant = runtime.state.messages.findIndex(
            (message, index) =>
              index >= attemptStart && message.role === "assistant",
          );
          runtime.state.messages = runtime.state.messages.slice(
            0,
            failedAssistant < 0 ? attemptStart : failedAssistant,
          );
          submitted = false;
          output = undefined;
          attempt--;
          continue;
        }
        throw new RoleSecurityError(SECURITY_ROLE_FAILURE);
      }
      if (id === "chuangyi-xietiaoyuan" && message?.role === "assistant") {
        const reply = message.content
          .filter((block) => block.type === "text")
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("")
          .trim();
        if ([INTERNAL_REFUSAL, CONTENT_REFUSAL].includes(reply)) {
          security.record(
            reply === INTERNAL_REFUSAL ? "internal_refusal" : "content_refusal",
          );
          output = reply;
          return complete();
        }
        if (
          ctx.loadCoordinatorInput &&
          !submitted &&
          reply &&
          message.stopReason === "stop" &&
          message.content.every((block) => block.type !== "toolCall")
        ) {
          output = reply;
          return complete();
        }
      }
      if (message?.role === "assistant" && message.stopReason === "length")
        throw new RoleTruncatedError(
          "Role output was truncated at max_tokens; no retry",
        );
      if (
        message?.role === "assistant" &&
        ["error", "aborted"].includes(message.stopReason)
      ) {
        if (message.stopReason === "aborted")
          throw new RoleAbortError("Role cancelled");
        const key = ctx.runtime.apiKey?.(model.provider);
        const reason = message.errorMessage ?? "Model request failed";
        throw new RoleProviderError(
          key ? reason.split(key).join("[REDACTED]") : reason,
        );
      }
      if (
        spec.output.kind === "text" &&
        message?.role === "assistant" &&
        message.stopReason === "stop" &&
        message.content.every((block) => block.type !== "toolCall")
      ) {
        const prose = message.content
          .filter((block) => block.type === "text")
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("")
          .trim();
        const proseErrors = checks.candidateProseErrors(prose);
        if (prose && !proseErrors.length) {
          output = prose;
          return complete();
        }
        lastValidationError =
          proseErrors.join("；") || "Role returned empty prose";
      }
      if (submitted) return complete();
      if (limitReached)
        throw new RoleTurnLimitError("Role exceeded its turn budget");
      if (!failures.some((f) => f.attempt === attemptNumber))
        recordFailure(
          lastValidationError ?? "Role did not submit a valid result",
        );
      correction = anchorError
        ? `${formatCorrection}\n${anchorCorrection(anchorError)}`
        : formatCorrection;
      resetReason = "format_correction";
    }
    throw new RoleOutputError(
      `Role did not submit a valid result after one correction${lastValidationError ? `: ${redact(lastValidationError)}` : ""}`,
    );
  } catch (error) {
    if (security.failure || security.inspect((error as Error).message))
      output = "";
    runtime.abort();
    let grace: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        runtime.waitForIdle(),
        new Promise<void>((resolve) => {
          grace = setTimeout(resolve, 1000);
        }),
      ]);
    } finally {
      if (grace) clearTimeout(grace);
    }
    const failure = security.failure
      ? new RoleSecurityError(SECURITY_ROLE_FAILURE)
      : error instanceof RoleExecutionError
        ? error
        : new RoleProviderError(redact((error as Error).message));
    if (!failures.some((f) => f.attempt === attemptNumber))
      recordFailure(failure.message);
    failure.partial = snapshot();
    throw failure;
  } finally {
    clearTimeout(timeout);
    ctx.signal?.removeEventListener("abort", abort);
  }
}

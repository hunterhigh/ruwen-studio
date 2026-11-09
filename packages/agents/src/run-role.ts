import { createHash } from "node:crypto";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { compile } from "@earendil-works/pi-schema";
import {
  applyEditorialEdits,
  applySectionEdits,
  checks,
  type EditorialEdit,
  handoff,
  publicTranscript,
  type SectionEdit,
  state,
} from "@ruwen/core";
import {
  editingPolicy,
  ROLE_OUTPUT_ATTEMPTS,
  roleGenerationPolicy,
} from "./models.ts";
import { assemblePrompt } from "./prompts/manifest.ts";
import { ROLES } from "./roles/index.ts";
import {
  listAuthorizedResources,
  readAuthorizedResource,
  roleTools,
} from "./tools/index.ts";
import {
  type Data,
  RoleAbortError,
  type RoleContext,
  RoleExecutionError,
  type RoleId,
  RoleOutputError,
  RoleProviderError,
  type RoleResult,
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
  if (id === "qinggan-duzhe" && Array.isArray(output.reactions))
    for (const reaction of output.reactions) {
      if (
        !object(reaction) ||
        typeof reaction.anchor !== "string" ||
        !String(input.prose).includes(reaction.anchor)
      )
        throw new RoleOutputError(
          "Reader anchor must occur in the current prose",
        );
    }
  if (id === "wenxue-bianji") {
    if (!Array.isArray(output.edits) || !Array.isArray(output.problems))
      throw new RoleOutputError(
        "Editor requires anchored edits and problem records",
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
  if (ctx.signal?.aborted)
    throw new RoleAbortError("Role cancelled before start");
  const spec = ROLES[id];
  const submitName =
    spec.output.kind === "tool" ? spec.output.toolName : undefined;
  const input = await prepareInput(id, rawInput, ctx);
  const user = spec.buildUserMessage(input);
  const prompt = await assemblePrompt(spec, ctx.upstreamRoot);
  await ctx.onPrompt?.(prompt);
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
  let output: Data | string | undefined;
  let submitted = false;
  let turns = 0;
  let limitReached = false;
  let timedOut = false;
  let lastValidationError: string | undefined;
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
        try {
          await validateOutput(id, value, input, readBodies);
        } catch (error) {
          lastValidationError = (error as Error).message;
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
    tools.map((tool) => [tool.name, compile(tool.parameters)]),
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
      ctx.onRequest?.(structuredClone(context), id);
      return ctx.runtime.models.streamSimple(selected, context, {
        ...options,
        cacheRetention: "long",
        maxTokens,
        maxRetries: 0,
      });
    },
    getApiKey: (provider) => ctx.runtime.apiKey?.(provider),
    beforeToolCall: async ({ toolCall, assistantMessage }, signal) => {
      if (assistantMessage.stopReason === "length")
        return { block: true, terminate: true, reason: "role_truncated" };
      if (signal?.aborted || submitted)
        return {
          block: true,
          terminate: true,
          reason: "role_already_finished",
        };
      const validator = validators.get(toolCall.name);
      if (!validator || !validator.check(toolCall.arguments))
        return {
          block: true,
          terminate: true,
          reason: "strict_schema_required",
        };
      return undefined;
    },
    finishTurn: (turn) => {
      turns++;
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
    if (event.type === "message_end" && event.message.role === "assistant")
      usage.push(structuredClone(event.message.usage));
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent.type === "text_delta"
    )
      ctx.onDelta?.(event.assistantMessageEvent.delta, id);
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
  const snapshot = (): RoleResult => ({
    runtimeMode: ctx.runtime.mode,
    output: output ?? "",
    usage: structuredClone(usage),
    costTotal: usage.reduce((total, item) => total + item.cost.total, 0),
    promptSha256: prompt.sha256,
    transcript: publicTranscript(
      JSON.parse(redact(JSON.stringify(runtime.state.messages))),
    ) as RoleResult["transcript"],
    model: `${model.provider}/${model.id}`,
    durationMs: performance.now() - started,
    readResources: [...reads.values()],
  });
  try {
    for (let attempt = 0; attempt < ROLE_OUTPUT_ATTEMPTS; attempt++) {
      if (ctx.signal?.aborted) throw new RoleAbortError("Role cancelled");
      await Promise.race([
        runtime.prompt(
          attempt === 0
            ? user
            : "上次输出未通过格式或内容校验。请依据当前岗位的输入与输出契约重新提交，只输出合法结果。",
        ),
        aborted,
      ]);
      const message = [...runtime.state.messages]
        .reverse()
        .find((m) => m.role === "assistant");
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
        if (prose && !checks.candidateProseErrors(prose).length) {
          output = prose;
          return snapshot();
        }
      }
      if (submitted) return snapshot();
      if (limitReached)
        throw new RoleTurnLimitError("Role exceeded its turn budget");
    }
    throw new RoleOutputError(
      `Role did not submit a valid result after one correction${lastValidationError ? `: ${redact(lastValidationError)}` : ""}`,
    );
  } catch (error) {
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
    const failure =
      error instanceof RoleExecutionError
        ? error
        : new RoleProviderError(redact((error as Error).message));
    failure.partial = snapshot();
    throw failure;
  } finally {
    clearTimeout(timeout);
    ctx.signal?.removeEventListener("abort", abort);
  }
}

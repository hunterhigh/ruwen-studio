import { Agent } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { compile } from "@earendil-works/pi-schema";
import { checks, handoff, state } from "@ruwen/core";
import { assemblePrompt } from "./prompts/manifest.ts";
import { ROLES } from "./roles/index.ts";
import { readAuthorizedResource, roleTools } from "./tools/index.ts";
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
      [
        "jiyi-weihuyuan",
        "zhangjie-qingjing-bianyiyuan",
        "biaoxian-shejishi",
      ].includes(id) &&
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
    if (
      Array.isArray(output.changes) &&
      output.changes.length &&
      typeof output.edited_text !== "string"
    )
      throw new RoleOutputError("Change records require edited prose");
    if (
      output.decision !== "LOCAL_EDIT" &&
      (typeof output.return_reason !== "string" ||
        !output.return_reason.trim() ||
        output.edited_text !== undefined)
    )
      throw new RoleOutputError(
        "Returned edits require a reason and cannot silently rewrite prose",
      );
    if (
      typeof output.edited_text === "string" &&
      output.edited_text !== input.prose &&
      (!Array.isArray(output.changes) || !output.changes.length)
    )
      throw new RoleOutputError("Substantive edits require change records");
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
  ctx: RoleContext,
): Promise<RoleResult> {
  if (!Object.hasOwn(ROLES, id)) throw new RoleOutputError("Unknown role");
  if (ctx.signal?.aborted)
    throw new RoleAbortError("Role cancelled before start");
  const spec = ROLES[id];
  const submitName =
    spec.output.kind === "tool" ? spec.output.toolName : undefined;
  const input = await prepareInput(id, rawInput, ctx);
  const user = spec.buildUserMessage(input);
  const prompt = await assemblePrompt(spec, ctx.upstreamRoot);
  const { model, thinkingLevel } = ctx.runtime.resolve(spec);
  const usage: Usage[] = [];
  const started = performance.now();
  const tools = roleTools(id, ctx);
  let output: Data | string | undefined;
  let submitted = false;
  let turns = 0;
  let limitReached = false;
  let timedOut = false;
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
        await validateOutput(id, value, input);
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
        maxTokens: ctx.maxTokens ?? 8000,
        maxRetries: 0,
      });
    },
    getApiKey: (provider) => ctx.runtime.apiKey?.(provider),
    beforeToolCall: async ({ toolCall }, signal) => {
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
  }, ctx.timeoutMs ?? 600_000);
  ctx.signal?.addEventListener("abort", abort, { once: true });
  const redact = (value: string) => {
    const key = ctx.runtime.apiKey?.(model.provider);
    return key ? value.split(key).join("[REDACTED]") : value;
  };
  const snapshot = (): RoleResult => ({
    output: output ?? "",
    usage: structuredClone(usage),
    costTotal: usage.reduce((total, item) => total + item.cost.total, 0),
    promptSha256: prompt.sha256,
    systemPrompt: prompt.content,
    transcript: JSON.parse(
      redact(JSON.stringify(runtime.state.messages)),
    ) as RoleResult["transcript"],
    model: `${model.provider}/${model.id}`,
    durationMs: performance.now() - started,
  });
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
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
      "Role did not submit a valid result after one correction",
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

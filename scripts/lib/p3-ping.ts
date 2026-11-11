import {
  type ModelRuntime,
  normalizeContext,
  ROLES,
} from "../../packages/agents/src/index.ts";
import { requestCostBound } from "./smoke-budget.ts";

/** Exactly two synthetic requests, no agent loop, hidden retry or project access. */
export async function runP3Ping(runtime: ModelRuntime) {
  let spent = 0,
    held = 0;
  const capUsd = 0.02,
    checks = [];
  for (const kind of ["text", "tool"] as const) {
    const { model, thinkingLevel } = runtime.resolve(
      ROLES[kind === "text" ? "qinggan-duzhe" : "xiangmu-zhiliyuan"],
    );
    const maxTokens = kind === "text" ? 128 : 1024;
    const context = normalizeContext({
      systemPrompt:
        "Connectivity check. Follow the user's short response instruction.",
      messages: [
        {
          role: "user",
          content:
            kind === "text"
              ? "Reply exactly PONG."
              : "Call p3_ping exactly once with ok=true. Do not produce prose.",
          timestamp: 0,
        },
      ],
      ...(kind === "tool"
        ? {
            tools: [
              {
                name: "p3_ping",
                description:
                  "Return a successful connectivity check; has no side effects.",
                parameters: {
                  type: "object",
                  properties: { ok: { type: "boolean", const: true } },
                  required: ["ok"],
                  additionalProperties: false,
                },
              },
            ],
          }
        : {}),
    });
    const boundUsd = requestCostBound(model, context, maxTokens);
    if (spent + held + boundUsd > capUsd)
      throw new Error("Ping USD 0.02 hard cap: request not sent");
    held += boundUsd;
    const started = performance.now();
    const message = await runtime.models
      .streamSimple(model, context, {
        maxTokens,
        ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
        maxRetries: 0,
        timeoutMs: 120000,
      })
      .result();
    const cost = message.usage.cost.total;
    const unknown =
      ["error", "aborted"].includes(message.stopReason) &&
      message.usage.totalTokens === 0;
    if (!Number.isFinite(cost) || cost < 0 || cost > boundUsd)
      throw new Error("Ping returned untrusted usage; stopped without retry");
    if (!unknown) held -= boundUsd;
    spent += cost;
    const ok =
      !["error", "aborted", "length"].includes(message.stopReason) &&
      (kind === "text"
        ? message.content.some(
            (b) => b.type === "text" && b.text.trim() === "PONG",
          )
        : message.content.some(
            (b) =>
              b.type === "toolCall" &&
              b.name === "p3_ping" &&
              b.arguments.ok === true &&
              Object.keys(b.arguments).length === 1,
          ));
    checks.push({
      kind,
      model: `${model.provider}/${model.id}`,
      thinkingLevel,
      maxTokens,
      ok,
      stopReason: message.stopReason,
      usage: message.usage,
      durationMs: Math.round(performance.now() - started),
      error:
        message.errorMessage ??
        (ok ? null : "Expected response missing or truncated"),
      boundUsd,
    });
  }
  return {
    version: 1,
    p3GatePassed: false,
    ok: checks.every((r) => r.ok),
    providerCalls: checks.length,
    costUsd: spent,
    heldUsd: held,
    capUsd,
    checks,
  };
}

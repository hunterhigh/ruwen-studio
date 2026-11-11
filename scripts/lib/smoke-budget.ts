import { readFile } from "node:fs/promises";
import path from "node:path";
import { requestRole } from "../../packages/agents/src/faux.ts";
import type { ModelRuntime, RoleId } from "../../packages/agents/src/index.ts";
import {
  coordinatorTape,
  replayCoordinatorTape,
} from "../../packages/agents/src/runtime/coordinator-tape.ts";
import { forwardStream } from "../../packages/agents/src/runtime/stream.ts";
import { stableRequestHash } from "../../packages/agents/src/runtime/tapes.ts";

type Model = ReturnType<ModelRuntime["resolve"]>["model"];
export type SmokeRequest = Parameters<
  ModelRuntime["models"]["streamSimple"]
>[1];
type Message = Awaited<
  ReturnType<ReturnType<ModelRuntime["models"]["streamSimple"]>["result"]>
>;
export type SmokeUsage = Message["usage"];
export interface SmokeCall {
  role: RoleId;
  model: string;
  phase: string;
  status: "running" | "completed" | "failed" | "budget_stopped";
  boundUsd: number;
  inputTokenBound: number;
  outputTokenBound: number;
  durationMs: number;
  usage?: SmokeUsage;
  stopReason?: string;
  failureOriginal?: unknown;
  recordedResponse?: unknown;
  tape?: string;
}
export class SmokeBudgetError extends Error {}
/** Text byte fallback bound; keep the JSON envelope as allowance for message/tool framing. */
export function requestInputBound(context: SmokeRequest) {
  for (const message of context.messages)
    if (
      Array.isArray(message.content) &&
      message.content.some((block) => block.type === "image")
    )
      throw new SmokeBudgetError(
        "Smoke byte budgets support text requests only",
      );
  // Tool schemas are plain JSON Schema in the installed SDK. Count every definition,
  // including transcript-level toolsAdded, not only the optional shorthand context.tools.
  const sentFields = new Set([
    "role",
    "content",
    "sections",
    "toolsAdded",
    "toolsRemoved",
    "toolCallId",
    "toolName",
    "isError",
  ]);
  const messages = context.messages.map((message) =>
    Object.fromEntries(
      Object.entries(message).filter(([key]) => sentFields.has(key)),
    ),
  );
  // Transport timings, usage/cost and model IDs are not sent as prompt content.
  const utf8Bytes = Buffer.byteLength(
    JSON.stringify({ ...context, messages }),
    "utf8",
  );
  const tools =
    (context.tools?.length ?? 0) +
    context.messages.reduce(
      (n, m) => n + (m.role === "system" ? (m.toolsAdded?.length ?? 0) : 0),
      0,
    );
  // Provider control tokens are not text bytes. Retain a separate conservative framing
  // allowance rather than silently treating bare content bytes as their upper bound.
  const framingTokens = 1024 + 256 * context.messages.length + 1024 * tools;
  return { utf8Bytes, framingTokens, tokens: utf8Bytes + framingTokens };
}
/** Actual request bytes, all input/cache rate ceilings, and the role's capped output. */
export function requestCostBound(
  model: Model,
  context: SmokeRequest,
  maxTokens = model.maxTokens,
) {
  const rates = [model.cost, ...(model.cost.tiers ?? [])];
  const max = (key: "input" | "output" | "cacheRead" | "cacheWrite") =>
    Math.max(
      ...rates.map((rate) => {
        const n = rate[key];
        if (!Number.isFinite(n) || n < 0)
          throw new SmokeBudgetError("Missing valid model price");
        return n;
      }),
    );
  if (
    !Number.isSafeInteger(model.contextWindow) ||
    model.contextWindow < 1 ||
    !Number.isSafeInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens > model.maxTokens
  )
    throw new SmokeBudgetError("Missing valid model token ceiling");
  return (
    Math.ceil(
      ((requestInputBound(context).tokens *
        (max("input") + max("cacheRead") + max("cacheWrite")) +
        maxTokens * max("output")) /
        1e6) *
        1e10,
    ) / 1e10
  );
}
export class SmokeBudget {
  readonly capUsd: number;
  readonly calls: SmokeCall[] = [];
  spentUsd = 0;
  heldUsd = 0;
  stopped = false;
  phase = "setup";
  constructor(capUsd = 5) {
    if (!Number.isFinite(capUsd) || capUsd <= 0)
      throw new SmokeBudgetError("--max-usd must be a finite positive number");
    this.capUsd = capUsd;
  }
  wrap(
    base: ModelRuntime,
    readSources?: () => readonly string[],
  ): ModelRuntime {
    const stream: ModelRuntime["models"]["streamSimple"] = (
      model,
      context,
      options,
    ) => {
      const role = requestRole(context as Parameters<typeof requestRole>[0]);
      const row: SmokeCall = {
        role,
        model: `${model.provider}/${model.id}`,
        phase: this.phase,
        status: "running",
        boundUsd: 0,
        inputTokenBound: 0,
        outputTokenBound: 0,
        durationMs: 0,
      };
      this.calls.push(row);
      const started = performance.now();
      const maxTokens = Math.min(
        options?.maxTokens ?? model.maxTokens,
        model.maxTokens,
      );
      let bound: number;
      try {
        if (options?.onPayload)
          throw new SmokeBudgetError(
            "Smoke byte budgets cannot allow a later payload transformation",
          );
        row.inputTokenBound = requestInputBound(context).tokens;
        row.outputTokenBound = maxTokens;
        bound = requestCostBound(model, context, maxTokens);
      } catch (error) {
        this.stopped = true;
        row.status = "budget_stopped";
        row.failureOriginal =
          "Missing trustworthy model pricing or token ceiling; request not sent";
        throw error;
      }
      row.boundUsd = bound;
      if (
        this.stopped ||
        this.spentUsd + this.heldUsd >= this.capUsd ||
        this.spentUsd + this.heldUsd + bound > this.capUsd
      ) {
        this.stopped = true;
        row.status = "budget_stopped";
        row.failureOriginal = "P3 smoke USD hard cap: request not sent";
        throw new SmokeBudgetError(String(row.failureOriginal));
      }
      this.heldUsd += bound;
      const sources = readSources?.().slice();
      try {
        // SDK transport retries have no independent usage receipt. Only role-level,
        // individually budgeted corrections are permitted by this tool.
        const requestOptions = { ...options, maxTokens, maxRetries: 0 };
        const hash = stableRequestHash(
          model,
          context as Parameters<typeof stableRequestHash>[1],
          requestOptions,
        );
        const file = base.privateStorageRoot
          ? path.join(
              base.privateStorageRoot,
              `${role === "chuangyi-xietiaoyuan" ? "coordinator-" : ""}${hash}.json`,
            )
          : undefined;
        return forwardStream(
          base.models.streamSimple(model, context, requestOptions),
          {
            signal: options?.signal,
            finish: async (message) => {
              row.durationMs = Math.round(performance.now() - started);
              row.usage = structuredClone(message.usage);
              row.stopReason = message.stopReason;
              row.status = ["error", "aborted", "length"].includes(
                message.stopReason,
              )
                ? "failed"
                : "completed";
              const cost = message.usage.cost.total;
              let budgetFailure: string | undefined;
              if (
                !Number.isFinite(cost) ||
                cost < 0 ||
                (["error", "aborted"].includes(message.stopReason) &&
                  message.usage.totalTokens === 0)
              ) {
                // Unknown generation usage remains reserved; no automatic retry can spend again.
                this.stopped = true;
                budgetFailure = "P3 smoke stopped: generation cost is unknown";
              } else {
                this.heldUsd -= bound;
                this.spentUsd += cost;
                if (
                  cost > bound + 1e-10 ||
                  this.spentUsd + this.heldUsd >= this.capUsd
                )
                  this.stopped = true;
                if (cost > bound + 1e-10)
                  budgetFailure =
                    "P3 smoke stopped: provider cost exceeds the reserved catalog bound";
                else if (this.spentUsd + this.heldUsd >= this.capUsd)
                  budgetFailure = "P3 smoke USD hard cap reached";
              }
              if (file) {
                row.tape = path.basename(file);
                try {
                  const stored = JSON.parse(await readFile(file, "utf8"));
                  if (stored.version === 4 && sources) {
                    const decoded = replayCoordinatorTape(
                      stored,
                      hash,
                      sources,
                    ) as { response: Message };
                    row.recordedResponse = coordinatorTape(hash, sources, {
                      response: decoded.response,
                    });
                    if (decoded.response.errorMessage)
                      row.failureOriginal = coordinatorTape(hash, sources, {
                        errorMessage: decoded.response.errorMessage,
                      });
                  } else if (stored.version === 3) {
                    row.recordedResponse = stored.response;
                    if (stored.response?.errorMessage)
                      row.failureOriginal = stored.response.errorMessage;
                  }
                  if (row.status === "failed" && !row.failureOriginal)
                    row.failureOriginal = row.recordedResponse;
                } catch {
                  if (row.status === "failed")
                    row.failureOriginal = {
                      code: "RECORDING_UNAVAILABLE",
                      message: "No safe recorded original is available",
                    };
                }
              }
              if (budgetFailure) {
                row.status = "budget_stopped";
                row.failureOriginal ??= budgetFailure;
                throw new SmokeBudgetError(budgetFailure);
              }
            },
          },
        );
      } catch (error) {
        this.heldUsd -= bound;
        row.status = "failed";
        row.durationMs = Math.round(performance.now() - started);
        // Before-stream failures have no safe model response; never serialize raw provider exceptions.
        row.failureOriginal = {
          code: "BEFORE_STREAM_FAILURE",
          message: "No recorded provider response",
        };
        throw error;
      }
    };
    const models = new Proxy(base.models, {
      get(target, key) {
        if (key === "streamSimple") return stream;
        if (
          [
            "stream",
            "complete",
            "completeSimple",
            "streamDeferred",
            "fetchDeferred",
          ].includes(String(key))
        )
          return () => {
            throw new SmokeBudgetError(
              "Smoke tool permits only budgeted streamSimple",
            );
          };
        const item = Reflect.get(target, key);
        return typeof item === "function" ? item.bind(target) : item;
      },
    });
    const bind = base.bindCoordinatorSources?.bind(base);
    return {
      ...base,
      models,
      ...(bind
        ? {
            bindCoordinatorSources: (read: () => readonly string[]) =>
              this.wrap(bind(read), read),
          }
        : {}),
    };
  }
}

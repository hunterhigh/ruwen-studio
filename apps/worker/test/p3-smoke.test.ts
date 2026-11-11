import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFauxRuntime, ROLES } from "@ruwen/agents";
import { afterEach, expect, inject, it } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import { forwardStream } from "../../../packages/agents/src/runtime/stream.ts";
import { runP3Smoke, smokeFaux } from "../../../scripts/lib/p3-smoke.ts";
import {
  requestCostBound,
  SmokeBudget,
} from "../../../scripts/lib/smoke-budget.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), "ruwen-smoke-test-"));
  cleanup.push(async () => {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("ruwen-smoke-test-")
    )
      throw new Error("Unsafe cleanup");
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  });
  return root;
}
it("one faux run records the entire workflow and fresh-project replay matches the full candidate without upstream calls", async () => {
  const directory = await folder();
  const record = await runP3Smoke({
    url: inject("databaseUrl"),
    directory,
    mode: "record",
  });
  expect(record.status, JSON.stringify(record)).toBe("completed");
  expect(record.steps.map((s) => s.phase)).toEqual([
    "conversation",
    "communication_gate",
    "downstream_preview",
    "compilation",
    "chapter",
    "memory_preview",
  ]);
  expect(record.steps.at(-1)?.status).toBe("AWAITING_MEMORY_APPROVAL");
  expect(record.candidate).not.toBe("");
  expect(record.memoryPreview).toBeTruthy();
  expect(record.maxUsd).toBe(5);
  expect(record.roles).toHaveLength(9); // coordinator + story + compiler + 6 chapter roles
  const offline = smokeFaux();
  let calls = 0;
  offline.models.streamSimple = (() => {
    calls++;
    throw new Error("No live fallback");
  }) as typeof offline.models.streamSimple;
  const replay = await runP3Smoke({
    url: inject("databaseUrl"),
    directory,
    mode: "replay",
    upstream: offline,
  });
  expect(replay.status, JSON.stringify(replay)).toBe("completed");
  expect(calls).toBe(0);
  expect(replay.candidate).toBe(record.candidate);
  expect(
    await readFile(path.join(directory, "candidate-replay.md"), "utf8"),
  ).toBe(record.candidate);
  expect(
    replay.roles.map((r) => [
      r.role,
      r.totalTokens,
      r.costUsd,
      r.retries,
      r.truncated,
    ]),
  ).toEqual(
    record.roles.map((r) => [
      r.role,
      r.totalTokens,
      r.costUsd,
      r.retries,
      r.truncated,
    ]),
  );
}, 60000);
it("rejects invalid caps and reserves the maximum pricing tier before a provider request", async () => {
  for (const cap of [0, -1, NaN, Infinity])
    expect(() => new SmokeBudget(cap)).toThrow("finite positive");
  const runtime = createFauxRuntime();
  const model = {
    ...runtime.resolve(ROLES["xiaoshuo-zuozhe"]).model,
    contextWindow: 10000,
    maxTokens: 1000,
    cost: {
      input: 1,
      output: 2,
      cacheRead: 1,
      cacheWrite: 1,
      tiers: [
        {
          inputTokensAbove: 1,
          input: 2,
          output: 4,
          cacheRead: 2,
          cacheWrite: 2,
        },
      ],
    },
  };
  expect(requestCostBound(model)).toBe(0.064);
  const budget = new SmokeBudget(0.01);
  let calls = 0;
  runtime.models.streamSimple = (() => {
    calls++;
    throw new Error("Must not call");
  }) as typeof runtime.models.streamSimple;
  const wrapped = budget.wrap(runtime);
  expect(() =>
    wrapped.models.streamSimple(
      model,
      {
        messages: [
          {
            role: "system",
            content: "CURRENT_ROLE:xiaoshuo-zuozhe",
            timestamp: 0,
          },
        ],
      },
      { maxTokens: 1000 },
    ),
  ).toThrow("hard cap");
  expect(calls).toBe(0);
  expect(budget.stopped).toBe(true);
  expect(budget.spentUsd).toBe(0);
});

it("counts actual cache usage, stops at the cap, and prevents concurrent or retried requests exceeding held budget", async () => {
  const response = (context: Parameters<typeof defaultFauxResponse>[0]) => ({
    ...defaultFauxResponse(context),
    usage: {
      input: 10,
      output: 5,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens: 20,
      cost: {
        input: 0.01,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0.01,
        totalFromProvider: true,
      },
    },
  });
  const source = createFauxRuntime([defaultFauxResponse, defaultFauxResponse]);
  const original = source.models.streamSimple.bind(source.models);
  source.models.streamSimple = ((model, context, options) =>
    forwardStream(original(model, context, options), {
      finish: async (message) => {
        message.usage = response(
          context as Parameters<typeof response>[0],
        ).usage;
      },
    })) as typeof original;
  const model = {
    ...source.resolve(ROLES["xiaoshuo-zuozhe"]).model,
    contextWindow: 1000,
    maxTokens: 1000,
    cost: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const context = {
    messages: [
      {
        role: "system" as const,
        content: "CURRENT_ROLE:xiaoshuo-zuozhe",
        timestamp: 0,
      },
    ],
  };
  const budget = new SmokeBudget(0.01),
    runtime = budget.wrap(source);
  const stream = runtime.models.streamSimple(model, context);
  expect(() => runtime.models.streamSimple(model, context)).toThrow("hard cap");
  expect((await stream.result()).stopReason).toBe("error");
  expect(budget.spentUsd).toBe(0.01);
  expect(budget.heldUsd).toBe(0);
  expect(source.faux.state.callCount).toBe(1);
  expect(budget.calls[0]?.usage).toMatchObject({ cacheRead: 3, cacheWrite: 2 });
  expect(() => runtime.models.streamSimple(model, context)).toThrow("hard cap");
});

it("reports truncation and safe failed original drafts rather than promoting a partial author response", async () => {
  const directory = await folder();
  const base = smokeFaux();
  const upstream = createFauxRuntime(
    Array.from({ length: 100 }, () => (context) => {
      if (requestRole(context) === "xiaoshuo-zuozhe")
        return { ...defaultFauxResponse(context), stopReason: "length" };
      return defaultFauxResponse(context);
    }),
  );
  // Keep the normal conversation response; truncate only the author provider call.
  const original = base.models.streamSimple.bind(base.models);
  base.models.streamSimple = ((model, context, options) =>
    requestRole(context as Parameters<typeof requestRole>[0]) ===
    "xiaoshuo-zuozhe"
      ? upstream.models.streamSimple(model, context, options)
      : original(model, context, options)) as typeof original;
  const report = await runP3Smoke({
    url: inject("databaseUrl"),
    directory,
    mode: "record",
    upstream: base,
  });
  expect(report.status).toBe("failed");
  expect(
    report.roles.find((r) => r.role === "xiaoshuo-zuozhe")?.truncated,
  ).toBe(true);
  expect(
    report.roles.find((r) => r.role === "xiaoshuo-zuozhe")?.failures.length,
  ).toBeGreaterThan(0);
  expect(report.candidateDrafts).toHaveLength(1);
  expect(report.memoryPreview).toBeNull();
}, 30000);

it("retains a conservative hold for unknown generation usage and refuses another request", async () => {
  const source = createFauxRuntime([defaultFauxResponse]);
  const original = source.models.streamSimple.bind(source.models);
  source.models.streamSimple = ((model, context, options) =>
    forwardStream(original(model, context, options), {
      finish: async (message) => {
        message.stopReason = "error";
        message.usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };
      },
    })) as typeof original;
  const model = {
    ...source.resolve(ROLES["xiaoshuo-zuozhe"]).model,
    contextWindow: 1000,
    maxTokens: 1000,
    cost: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const budget = new SmokeBudget(5),
    runtime = budget.wrap(source),
    context = {
      messages: [
        {
          role: "system" as const,
          content: "CURRENT_ROLE:xiaoshuo-zuozhe",
          timestamp: 0,
        },
      ],
    };
  await runtime.models.streamSimple(model, context).result();
  expect(budget.heldUsd).toBe(0.01);
  expect(budget.stopped).toBe(true);
  expect(() => runtime.models.streamSimple(model, context)).toThrow("hard cap");
  expect(source.faux.state.callCount).toBe(1);
});

it("reports a corrected author attempt once without counting normal tool turns as retries", async () => {
  const directory = await folder(),
    base = smokeFaux(),
    bad = createFauxRuntime([
      (context) => ({
        ...defaultFauxResponse(context),
        content: [
          { type: "text", text: "# 规划说明\n我将先按要求完成每一项检查。" },
        ],
        stopReason: "stop",
      }),
    ]);
  const original = base.models.streamSimple.bind(base.models);
  let author = 0;
  base.models.streamSimple = ((model, context, options) =>
    requestRole(context as Parameters<typeof requestRole>[0]) ===
      "xiaoshuo-zuozhe" && author++ === 0
      ? bad.models.streamSimple(model, context, options)
      : original(model, context, options)) as typeof original;
  const report = await runP3Smoke({
    url: inject("databaseUrl"),
    directory,
    mode: "record",
    upstream: base,
  });
  expect(report.status, JSON.stringify(report)).toBe("completed");
  expect(report.roles.find((r) => r.role === "xiaoshuo-zuozhe")?.retries).toBe(
    1,
  );
  expect(report.roles.find((r) => r.role === "jiyi-weihuyuan")?.retries).toBe(
    0,
  );
  expect(report.candidateDrafts).toHaveLength(2);
}, 30000);

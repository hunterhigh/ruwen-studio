import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createFauxRuntime,
  ROLES,
  type RoleId,
  resolveRoute,
} from "@ruwen/agents";
import { afterEach, expect, inject, it, vi } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import { forwardStream } from "../../../packages/agents/src/runtime/stream.ts";
import { demoArchive } from "../../../scripts/lib/demo-archive.ts";
import { runP3Smoke, smokeFaux } from "../../../scripts/lib/p3-smoke.ts";
import {
  requestCostBound,
  requestInputBound,
  SmokeBudget,
} from "../../../scripts/lib/smoke-budget.ts";
import { formatSmokePlan, smokePlan } from "../../../scripts/lib/smoke-plan.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
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
  for (const call of record.calls) {
    if (!call.usage) throw new Error("Missing usage");
    expect(call.inputTokenBound).toBeGreaterThanOrEqual(
      call.usage.input + call.usage.cacheRead + call.usage.cacheWrite,
    );
    expect(call.outputTokenBound).toBeGreaterThanOrEqual(call.usage.output);
    expect(call.boundUsd).toBeGreaterThanOrEqual(call.usage.cost.total);
  }
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
  const sample = {
    messages: [
      {
        role: "system" as const,
        content: "CURRENT_ROLE:xiaoshuo-zuozhe",
        timestamp: 0,
      },
    ],
  };
  expect(requestCostBound(model, sample)).toBe(
    Math.ceil(
      ((requestInputBound(sample).tokens * 6 + 1000 * 4) / 1e6) * 1e10,
    ) / 1e10,
  );
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
  let charge = 0.01;
  const response = (context: Parameters<typeof defaultFauxResponse>[0]) => ({
    ...defaultFauxResponse(context),
    usage: {
      input: 10,
      output: 5,
      cacheRead: 3,
      cacheWrite: 2,
      totalTokens: 20,
      cost: {
        input: charge,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: charge,
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
  charge = requestCostBound(model, context);
  const budget = new SmokeBudget(charge),
    runtime = budget.wrap(source);
  const stream = runtime.models.streamSimple(model, context);
  expect(() => runtime.models.streamSimple(model, context)).toThrow("hard cap");
  expect((await stream.result()).stopReason).toBe("error");
  expect(budget.spentUsd).toBe(charge);
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
  expect(budget.heldUsd).toBe(requestCostBound(model, context));
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

it.each([
  false,
  true,
])("reports the real handoff field failure and preserves one correction (always invalid=%s)", async (alwaysInvalid) => {
  const directory = await folder(),
    base = smokeFaux();
  const bad = createFauxRuntime(
    Array.from({ length: 2 }, () => (context) => {
      const response = defaultFauxResponse(context);
      const call = response.content.find(
        (b) => b.type === "toolCall" && b.name === "propose_handoff",
      );
      if (!call || call.type !== "toolCall") throw new Error("Missing handoff");
      (call.arguments.payload as Record<string, unknown>).open_realization =
        "保留动作与对白的选择";
      return response;
    }),
  );
  const original = base.models.streamSimple.bind(base.models);
  let turns = 0;
  base.models.streamSimple = ((model, context, options) => {
    const role = requestRole(context as Parameters<typeof requestRole>[0]);
    if (role === "chuangyi-xietiaoyuan") {
      turns++;
      if (turns === 2 || (alwaysInvalid && turns === 3))
        return bad.models.streamSimple(model, context, options);
      if (turns === 3)
        expect(
          JSON.stringify(
            context.messages.filter((m) => m.role === "toolResult"),
          ),
        ).toContain("/payload/open_realization: expected array, got string");
    }
    return original(model, context, options);
  }) as typeof original;
  const report = await runP3Smoke({
    url: inject("databaseUrl"),
    directory,
    mode: "record",
    upstream: base,
  });
  expect(report.status, report.failure ?? "").toBe(
    alwaysInvalid ? "failed" : "completed",
  );
  const coordinator = report.roles.find(
    (r) => r.role === "chuangyi-xietiaoyuan",
  );
  expect(coordinator?.retries).toBe(1);
  expect(coordinator?.failures).toHaveLength(alwaysInvalid ? 2 : 1);
  expect(coordinator?.failures[0]).toMatchObject({
    tool: "propose_handoff",
    issues: [
      {
        path: "/payload/open_realization",
        keyword: "type",
        message: "expected array, got string",
      },
    ],
  });
  expect(report.calls.flatMap((c) => c.validationFailures ?? [])).toHaveLength(
    alwaysInvalid ? 2 : 1,
  );
  expect(turns).toBe(3);
  if (alwaysInvalid) {
    expect(report.failure).toContain("CREATION_CHECK_FAILED");
    expect(report.steps.map((s) => s.phase)).toEqual([
      "conversation",
      "communication_gate",
    ]);
    expect(report.candidate).toBe("");
  } else {
    expect(report.steps.at(-1)?.status).toBe("AWAITING_MEMORY_APPROVAL");
    expect(report.candidate.length).toBeGreaterThan(0);
  }
}, 30000);

it("disables hidden SDK transport retries even when a caller requests them", async () => {
  let retries: number | undefined;
  const source = createFauxRuntime([
    (context, options) => {
      retries = options?.maxRetries;
      return defaultFauxResponse(context);
    },
  ]);
  const runtime = new SmokeBudget(5).wrap(source),
    model = source.resolve(ROLES["xiaoshuo-zuozhe"]).model;
  await runtime.models
    .streamSimple(
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
      { maxRetries: 5 },
    )
    .result();
  expect(retries).toBe(0);
  expect(source.faux.state.callCount).toBe(1);
});

it("takes a source ZIP without replacing source files or directory metadata", async () => {
  const root = await folder(),
    file = path.join(root, "note.md");
  await writeFile(file, "read-only demo source");
  const identity = async () =>
    Promise.all(
      [root, file].map(async (p) => {
        const s = await lstat(p, { bigint: true });
        return [s.ino, s.mtimeNs, s.ctimeNs];
      }),
    );
  const before = await identity();
  const zip = await demoArchive(root);
  expect(zip.byteLength).toBeGreaterThan(0);
  expect(await identity()).toEqual(before);
  expect(await readFile(file, "utf8")).toBe("read-only demo source");
});

it("bounds UTF-8 system/messages and both forms of tool schemas, independent of contextWindow", () => {
  const runtime = createFauxRuntime(),
    model = runtime.resolve(ROLES["xiaoshuo-zuozhe"]).model;
  const context = {
    systemPrompt: "系统😀",
    messages: [
      { role: "user" as const, content: '多字节\n引号"', timestamp: 0 },
    ],
    tools: [
      {
        name: "lookup",
        description: "资料",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "中".repeat(500) },
          },
        },
      },
    ],
  };
  const bound = requestInputBound(context);
  expect(bound.utf8Bytes).toBe(
    Buffer.byteLength(
      JSON.stringify({
        ...context,
        messages: [{ role: "user", content: context.messages[0]?.content }],
      }),
      "utf8",
    ),
  );
  expect(
    requestInputBound({
      ...context,
      messages: context.messages.map((m) => ({ ...m, timestamp: Date.now() })),
    }),
  ).toEqual(bound);
  expect(bound.tokens).toBeGreaterThan(bound.utf8Bytes);
  expect(requestInputBound({ ...context, tools: [] }).tokens).toBeLessThan(
    bound.tokens,
  );
  expect(
    requestCostBound(
      { ...model, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
      context,
      1000,
    ),
  ).toBe(
    requestCostBound(
      {
        ...model,
        contextWindow: 1,
        cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 },
      },
      context,
      1000,
    ),
  );
  const transcript = {
    messages: [
      {
        role: "system" as const,
        content: "系统",
        timestamp: 0,
        toolsAdded: context.tools,
      },
    ],
  };
  expect(requestInputBound(transcript).utf8Bytes).toBeGreaterThan(1500);
});

it.each([
  "default",
  "deepseek",
])("plans all demo tool turns with profile %s and no provider/fetch or recording, identifies the first budget block", async (profile) => {
  vi.stubEnv("MODEL_PROFILE", profile);
  const directory = await folder(),
    fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("Planner cannot fetch");
    });
  const report = await runP3Smoke({
    url: inject("databaseUrl"),
    directory,
    mode: "record",
    planOnly: true,
    maxUsd: 5,
  });
  expect(report.status, report.failure ?? "").toBe("completed");
  expect(report.providerCalls).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
  const plan = smokePlan(report);
  expect(plan.profile).toBe(profile);
  expect(plan.requests).toHaveLength(11);
  expect(plan.requests.filter((r) => r.role === "jiyi-weihuyuan")).toHaveLength(
    2,
  );
  for (const r of plan.requests) {
    const route = resolveRoute(ROLES[r.role as RoleId]);
    expect(r.model).toBe(`${route.provider}/${route.modelId}`);
  }
  expect(formatSmokePlan(plan)).toContain("provider calls=0");
  const enough = smokePlan({ ...report, maxUsd: plan.totalBoundUsd + 1 });
  expect(enough.canFinish).toBe(true);
  expect(enough.blockedAt).toBeNull();
  const tiny = smokePlan({
    ...report,
    maxUsd: (plan.requests[0]?.boundUsd ?? 1) / 2,
  });
  expect(tiny.blockedAt).toBe(1);
  const first = plan.requests[0],
    second = plan.requests[1];
  if (!first || !second) throw new Error("Missing plan requests");
  expect(
    smokePlan({ ...report, maxUsd: first.boundUsd + second.boundUsd / 2 })
      .blockedAt,
  ).toBe(2);
  expect(
    await import("node:fs/promises").then((io) => io.readdir(directory)),
  ).toEqual([]);
}, 30000);

it("rejects unbounded image or post-measurement payload changes before a provider call", () => {
  const source = createFauxRuntime(),
    model = source.resolve(ROLES["xiaoshuo-zuozhe"]).model;
  const context = {
    messages: [
      {
        role: "system" as const,
        content: "CURRENT_ROLE:xiaoshuo-zuozhe",
        timestamp: 0,
      },
    ],
  };
  expect(() =>
    new SmokeBudget()
      .wrap(source)
      .models.streamSimple(model, context, { onPayload: () => ({}) }),
  ).toThrow("payload transformation");
  expect(() =>
    requestInputBound({
      messages: [
        {
          role: "user",
          content: [{ type: "image", data: "", mimeType: "image/png" }],
          timestamp: 0,
        },
      ],
    }),
  ).toThrow("text requests only");
  expect(source.faux.state.callCount).toBe(0);
});

import { randomUUID } from "node:crypto";
import {
  createFauxRuntime,
  type Data,
  fauxOutput,
  type RoleId,
} from "@ruwen/agents";
import {
  approval,
  exportProjectZip,
  importProjectZip,
  packet,
  registry,
  state,
} from "@ruwen/core";
import { PostgresFS } from "@ruwen/db";
import type {
  IdeationActor,
  IdeationExpressionPreview,
  IdeationPreview,
  IdeationResult,
} from "@ruwen/pipeline";
import { afterEach, expect, inject, it } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import { EXPRESSION_CHECKS } from "../../../packages/agents/src/roles/expression-phase.ts";
import { ideationAuthorManifest } from "../../../packages/pipeline/src/ideation/compilation.ts";
import { IdeationServiceBackend } from "../../../packages/pipeline/src/ideation/specialized.ts";
import { createIdeationService } from "../src/ideation-service.ts";
import { fixture } from "./helpers.ts";
import { killIdeationAt } from "./ideation-fault.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
const value = <T>(r: IdeationResult<T>): T => {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
};
async function setup(
  options: {
    review?: "missing" | "high";
    content?: string;
    generation?: string;
    invent?: boolean;
    trial?: string;
    failBeforeProvider?: boolean;
  } = {},
) {
  const requests: { role: RoleId; input: string }[] = [];
  const runtime = createFauxRuntime(
    Array.from({ length: 80 }, () => (context) => {
      const role = requestRole(context),
        input = JSON.stringify(context.messages);
      requests.push({ role, input });
      const response = defaultFauxResponse(context);
      if (role === "chuangyi-xietiaoyuan") {
        const output = fauxOutput(role, {
          project_state: { project: "demo-ruwen" },
        }) as Data;
        output.recipient = "biaoxian-shejishi";
        return {
          ...response,
          content: [
            {
              type: "toolCall",
              id: randomUUID(),
              name: "propose_handoff",
              arguments: output,
            },
          ],
          stopReason: "toolUse",
        };
      }
      if (
        role === "biaoxian-shejishi" &&
        !input.includes('field=\\"noncanonical_trial\\"')
      ) {
        const output = fauxOutput(role) as Data;
        output.content =
          options.content ??
          "身体负荷和人物所知共同改变注意的范围，选择仍随处境保留。";
        if (options.review !== "missing")
          output.closure_review = EXPRESSION_CHECKS.map((category, i) => ({
            category,
            risk: options.review === "high" && i === 0 ? "high" : "low",
            resolved: !(options.review === "high" && i === 0),
            summary: "已检查本项，开放选择仍由当前处境决定。",
          }));
        return {
          ...response,
          content: [
            {
              type: "toolCall",
              id: randomUUID(),
              name: "submit_expression_preview",
              arguments: output,
            },
          ],
          stopReason: "toolUse",
        };
      }
      if (role === "biaoxian-shejishi" && options.trial)
        return {
          ...response,
          content: [
            {
              type: "toolCall",
              id: randomUUID(),
              name: "submit_expression_trial",
              arguments: { sample: options.trial, canonical: false },
            },
          ],
          stopReason: "toolUse",
        };
      if (role === "zhangjie-qingjing-bianyiyuan") {
        const call = response.content.find((v) => v.type === "toolCall");
        if (call?.type === "toolCall") {
          if (options.generation)
            call.arguments.generation_field = options.generation;
          if (options.invent)
            call.arguments.locked_events = ["凭空固定一个未批准结局。"];
        }
      }
      return response;
    }),
  );
  const p = await fixture({
    runtime: () => runtime,
    onBoundary: async (kind) => {
      if (options.failBeforeProvider && kind === "role_intent")
        throw new Error("Injected pre-provider failure");
    },
  });
  cleanup.push(() => p.service.stop());
  const actor = {
      userId: p.fs.ownerId,
      projectId: p.fs.projectId,
    } as IdeationActor,
    service = createIdeationService(p.service.db, {
      modelMode: "faux",
      queue: p.service.queue,
    });
  const session = value(
    await service.createIdeationSession(actor, {
      clientRequestId: randomUUID() as never,
    }),
  );
  const raw =
    "COORDINATOR_ONLY_原始用户措辞绝不进入下游预览或事件甲乙丙丁戊己庚辛";
  const handle = (id: string) =>
    p.service.handle({
      kind: "ideation",
      projectId: actor.projectId,
      ownerId: actor.userId,
      runId: id,
    });
  const approve = (preview: IdeationPreview, clientRequestId = randomUUID()) =>
    service.approvePreview(actor, {
      previewId: preview.id,
      expectedSha256: preview.sha256,
      confirmed: true,
      clientRequestId: clientRequestId as never,
    });
  const pending = async () =>
    value(
      await service.listPreviews(actor, {
        sessionId: session.id,
        status: "pending",
      }),
    ).items;
  const proposal = async () => {
    const sent = value(
      await service.sendIdeationMessage(actor, {
        sessionId: session.id,
        expectedSessionRevision: 0,
        content: raw,
        clientRequestId: randomUUID() as never,
      }),
    );
    await handle(sent.turnId);
    const handoff = (await pending())[0];
    if (!handoff) throw new Error("handoff");
    const id = value(await approve(handoff)).startedTaskId;
    if (!id) throw new Error("task");
    await handle(id);
    const preview = (await pending())[0];
    if (!preview || preview.kind !== "expression_candidate")
      throw new Error("expression");
    return preview;
  };
  const compile = (overrides: object = {}) =>
    service.requestIdeationCompilation(actor, {
      sessionId: session.id,
      chapter: "001",
      scope: {
        volume: "v1",
        arc: "station",
        scene_type: "travel",
        pov: "林川",
      },
      sources: [],
      clientRequestId: randomUUID() as never,
      ...overrides,
    });
  return {
    ...p,
    db: p.service.db,
    worker: p.service,
    actor,
    service,
    session,
    raw,
    requests,
    handle,
    approve,
    pending,
    proposal,
    compile,
  };
}
const activationRequest = (preview: IdeationExpressionPreview) => ({
  previewId: preview.id,
  expectedSha256: preview.sha256,
  confirmed: true as const,
  resourceId: preview.resource.id,
  expectedResourceSha256: preview.resource.sha256,
  trialReadConfirmed: true as const,
  clientRequestId: randomUUID() as never,
});
function failingDecision(p: Awaited<ReturnType<typeof setup>>) {
  return new IdeationServiceBackend(
    {
      transaction: (actor, fn) =>
        p.service.store.transaction(actor, (tx) =>
          fn(
            new Proxy(tx, {
              get(target, key) {
                if (key === "sql")
                  return (query: string, args: unknown[]) => {
                    if (query.startsWith("INSERT INTO ideation_decisions"))
                      throw new Error("Injected decision persistence failure");
                    return target.sql(query, args);
                  };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ),
        ),
    },
    p.service.options,
  );
}

it("audit → candidate approval → isolated noncanonical trial → explicit activation commits bound evidence once and never admits the candidate to a formal author packet", async () => {
  const p = await setup(),
    preview = await p.proposal();
  expect(preview.closureAudit.status).toBe("passed");
  expect(await p.fs.exists(preview.resource.path)).toBe(false);
  const receipt = value(await p.approve(preview));
  if (!receipt.startedTaskId) throw new Error("trial");
  let candidate = (await registry.readRegistry(p.fs)).resources.find(
    (r) => r.id === preview.resource.id,
  );
  expect(candidate).toMatchObject({
    status: "candidate",
    approval: { status: "unapproved" },
  });
  const scope = {
    project: "demo-ruwen",
    volume: "v1",
    arc: "station",
    chapter: "001",
    scene_type: "travel",
    pov: "林川",
  };
  expect(
    (await registry.select(p.fs, scope, true)).some(
      (r) => r.id === preview.resource.id,
    ),
  ).toBe(false);
  expect(
    p.requests.filter((r) =>
      r.input.includes('field=\\"noncanonical_trial\\"'),
    ),
  ).toHaveLength(0);
  await p.handle(receipt.startedTaskId);
  expect(
    value(
      await p.service.getIdeationTask(p.actor, {
        taskId: receipt.startedTaskId,
      }),
    ),
  ).toMatchObject({ status: "AWAITING_PREVIEW_APPROVAL", error: null });
  const activation = (await p.pending())[0];
  if (!activation || activation.kind !== "expression_candidate")
    throw new Error("activation");
  expect(activation.approvalStage).toBe("activation");
  expect(activation.id).not.toBe(preview.id);
  expect(activation.trial.sample).toBeTruthy();
  expect(await p.fs.exists(activation.trial.report?.path ?? "missing")).toBe(
    false,
  );
  expect(
    value(
      await p.service.getIdeationTask(p.actor, {
        taskId: receipt.startedTaskId,
      }),
    ).finishedAt,
  ).toBeNull();
  const req = activationRequest(activation);
  expect(
    await p.service.activateExpression(p.actor, {
      ...req,
      expectedSha256: [] as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  expect(
    await p.service.activateExpression(p.actor, {
      ...req,
      trialReadConfirmed: false as never,
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "NONCANONICAL_TRIAL_REQUIRED" },
  });
  expect(await p.approve(activation)).toMatchObject({
    ok: false,
    error: { code: "NONCANONICAL_TRIAL_REQUIRED" },
  });
  const q = await setup();
  for (const actor of [q.actor, { ...p.actor, userId: q.actor.userId }])
    expect(await p.service.activateExpression(actor, req)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  expect(
    await p.service.activateExpression(p.actor, {
      ...req,
      resourceId: "biaoxian-xiangmu-shengyin" as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  const before = await p.fs.list("治理/审批");
  expect(
    await failingDecision(p).activateExpression(p.actor, req),
  ).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  expect(await p.fs.list("治理/审批")).toEqual(before);
  expect(
    (await registry.readRegistry(p.fs)).resources.find(
      (r) => r.id === preview.resource.id,
    )?.status,
  ).toBe("candidate");
  expect(await p.fs.exists(activation.trial.report?.path ?? "missing")).toBe(
    false,
  );
  const result = value(await p.service.activateExpression(p.actor, req));
  expect(result.coreApprovals[0]?.action).toBe("expression_activate");
  expect(await p.service.activateExpression(p.actor, req)).toEqual({
    ok: true,
    value: result,
  });
  expect(
    await p.service.activateExpression(p.actor, {
      ...req,
      clientRequestId: randomUUID() as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "ALREADY_DECIDED" } });
  candidate = (await registry.readRegistry(p.fs)).resources.find(
    (r) => r.id === preview.resource.id,
  );
  expect(candidate?.status).toBe("active");
  if (!candidate) throw new Error("resource");
  expect(
    await registry.validateTrialEvidence(p.fs, candidate, candidate.approval),
  ).toEqual([]);
  expect(
    await registry.validateClosureEvidence(p.fs, candidate, candidate.approval),
  ).toEqual([]);
  expect(
    await approval.eventIsCommitted(p.fs, result.coreApprovals[0]?.id ?? ""),
  ).toBe(true);
  expect((await registry.validateRegistry(p.fs)).errors).toEqual([]);
  const downstream = p.requests.filter(
    (r) => r.role !== "chuangyi-xietiaoyuan",
  );
  expect(downstream).toHaveLength(2);
  for (const r of downstream) {
    expect(r.input).not.toContain(p.raw);
    expect(r.input).not.toContain("raw_user_text");
  }
  expect(downstream[1]?.input).toContain("trial_candidate");
  const copyId = randomUUID();
  await p.db.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'demo-ruwen','ZIP roundtrip')",
    [copyId, p.actor.userId],
  );
  const restored = new PostgresFS(p.db, copyId, p.actor.userId);
  await importProjectZip(restored, await exportProjectZip(p.fs));
  for (const path of await restored.list()) {
    expect(path).not.toContain(p.raw);
    expect(await restored.readText(path)).not.toContain(p.raw);
  }
  expect(
    JSON.stringify(
      value(
        await p.service.listIdeationEvents(p.actor, {
          sessionId: p.session.id,
        }),
      ),
    ),
  ).not.toContain(p.raw);
}, 30000);

it.each([
  "missing",
  "high",
  "automatic",
] as const)("%s closure evidence cannot move proposed text into the registry or run a trial", async (mode) => {
  const p = await setup(
    mode === "automatic"
      ? { content: "必须逐项完成以下动作，然后最后完成交接。" }
      : { review: mode },
  );
  const preview = await p.proposal();
  expect(preview.closureAudit.status).not.toBe("passed");
  const count = p.requests.length;
  expect(await p.approve(preview)).toMatchObject({
    ok: false,
    error: { code: "CLOSURE_AUDIT_REQUIRED" },
  });
  expect(p.requests).toHaveLength(count);
  expect(await p.fs.exists(preview.resource.path)).toBe(false);
  expect(
    (await registry.readRegistry(p.fs)).resources.some(
      (r) => r.id === preview.resource.id,
    ),
  ).toBe(false);
}, 30000);

it("compiler reads only owned approved facts; preview approval registers state and synchronizes the default manifest so a real author packet compiles", async () => {
  const p = await setup();
  const oldState = await p.fs.sha256(state.STATE),
    oldManifest = await p.fs.sha256(ideationAuthorManifest);
  const requestId = randomUUID();
  const task = value(await p.compile({ clientRequestId: requestId }));
  expect(p.requests).toHaveLength(0);
  await p.handle(task.id);
  const preview = (await p.pending())[0];
  if (!preview || preview.kind !== "generation_field") throw new Error("field");
  expect(preview.characterCount).toBeLessThanOrEqual(2200);
  expect(await p.fs.exists(preview.projection.path)).toBe(false);
  expect(await p.fs.sha256(state.STATE)).toBe(oldState);
  expect(await p.fs.sha256(ideationAuthorManifest)).toBe(oldManifest);
  expect(
    await failingDecision(p).approvePreview(p.actor, {
      previewId: preview.id,
      expectedSha256: preview.sha256,
      confirmed: true,
      clientRequestId: randomUUID() as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  expect(await p.fs.sha256(state.STATE)).toBe(oldState);
  expect(await p.fs.sha256(ideationAuthorManifest)).toBe(oldManifest);
  expect(await p.fs.exists(preview.projection.path)).toBe(false);
  value(await p.approve(preview));
  expect((await state.loadState(p.fs)).active_projection).toMatchObject({
    path: preview.projection.path,
    sha256: preview.projection.sha256,
  });
  const compiled = await packet.compilePacket(p.fs, ideationAuthorManifest);
  expect(value(await p.compile({ clientRequestId: requestId }))).toEqual(task);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_tasks WHERE project_id=$1",
        [p.actor.projectId],
      )
    ).rowCount,
  ).toBe(1);
  expect(compiled.output).toBeTruthy();
  expect(await p.fs.readText(String(compiled.output))).toContain(
    preview.generationField,
  );
  expect(p.requests).toHaveLength(1);
  expect(p.requests[0]?.input).not.toContain("raw_user_text");
  expect(p.requests[0]?.input).not.toContain("conversation");
}, 30000);

it("a closed coordinator session preserves accepted compilation; real compiler requests, previews, role caches and events exclude its raw wording", async () => {
  const p = await setup();
  await p.proposal();
  const task = value(await p.compile());
  value(
    await p.service.closeIdeationSession(p.actor, {
      sessionId: p.session.id,
      clientRequestId: randomUUID() as never,
    }),
  );
  await p.handle(task.id);
  const preview = (await p.pending()).find(
    (v) => v.kind === "generation_field",
  );
  expect(preview).toBeDefined();
  const compiler = p.requests.filter(
    (r) => r.role === "zhangjie-qingjing-bianyiyuan",
  );
  expect(compiler).toHaveLength(1);
  expect(compiler[0]?.input).not.toContain(p.raw);
  expect(
    JSON.stringify({
      preview,
      events: value(
        await p.service.listIdeationEvents(p.actor, {
          sessionId: p.session.id,
        }),
      ),
      cache: (
        await p.db.pool.query(
          "SELECT result,transcript FROM role_runs WHERE run_id=$1",
          [task.id],
        )
      ).rows,
    }),
  ).not.toContain(p.raw);
}, 30000);

it("changed closure evidence makes an activation preview stale instead of accepting a boolean confirmation", async () => {
  const p = await setup(),
    preview = await p.proposal();
  const id = value(await p.approve(preview)).startedTaskId;
  if (!id) throw new Error("trial");
  await p.handle(id);
  const activation = (await p.pending())[0];
  if (
    !activation ||
    activation.kind !== "expression_candidate" ||
    !activation.closureAudit.report
  )
    throw new Error("activation");
  await p.fs.write(
    activation.closureAudit.report.path,
    `${await p.fs.readText(activation.closureAudit.report.path)}\n`,
  );
  expect(
    value(await p.service.getPreview(p.actor, { previewId: activation.id }))
      .status,
  ).toBe("stale");
  expect(
    await p.service.activateExpression(p.actor, activationRequest(activation)),
  ).toMatchObject({ ok: false, error: { code: "PREVIEW_STALE" } });
  expect(
    (await registry.readRegistry(p.fs)).resources.find(
      (r) => r.id === preview.resource.id,
    )?.status,
  ).toBe("candidate");
}, 30000);

it("a live intent rejected before any provider call releases its unused hold; recovered unknown intents remain under review", async () => {
  const p = await setup({ failBeforeProvider: true }),
    task = value(await p.compile());
  await p.handle(task.id);
  expect(p.requests).toHaveLength(0);
  expect(
    (
      await p.db.pool.query(
        "SELECT status,usage_unknown,cost_usd::text FROM role_runs WHERE run_id=$1",
        [task.id],
      )
    ).rows[0],
  ).toMatchObject({
    status: "blocked",
    usage_unknown: false,
    cost_usd: "0.0000000000",
  });
  expect(
    (
      await p.db.pool.query(
        "SELECT status,remaining::text FROM credit_reservations WHERE run_id=$1",
        [task.id],
      )
    ).rows[0],
  ).toEqual({ status: "released", remaining: "0" });
}, 30000);

it("noncanonical trial contamination fails without an activation preview or automatic retry, preserving the candidate and actual usage once", async () => {
  const p = await setup({
      trial: `${"院外的雨落在河面上。".repeat(12)}\n# 自检\n本章逐项落实了大纲要求。`,
    }),
    preview = await p.proposal();
  const id = value(await p.approve(preview)).startedTaskId;
  if (!id) throw new Error("trial");
  const before = p.requests.length;
  await p.handle(id);
  await p.handle(id);
  expect(p.requests.length - before).toBe(1);
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: id })),
  ).toMatchObject({ status: "FAILED", error: { code: "OUTPUT_BLOCKED" } });
  expect(await p.pending()).toEqual([]);
  expect(
    (await registry.readRegistry(p.fs)).resources.find(
      (r) => r.id === preview.resource.id,
    )?.status,
  ).toBe("candidate");
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM role_cost_events e JOIN role_runs r ON r.id=e.role_run_id WHERE r.run_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(1);
}, 30000);

it.each([
  "role_response",
  "role_completed",
])("compiler SIGKILL at %s restores metadata without another provider request or duplicate projection previews", async (boundary) => {
  const p = await setup(),
    task = value(await p.compile());
  await killIdeationAt(
    p.db,
    p.actor.projectId,
    {
      kind: "ideation",
      projectId: p.actor.projectId,
      ownerId: p.actor.userId,
      runId: task.id,
    },
    boundary,
    inject("databaseUrl"),
    p.worker.queue,
  );
  await p.handle(task.id);
  await p.handle(task.id);
  expect(p.requests).toHaveLength(0);
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: task.id })).status,
  ).toBe(
    boundary === "role_response" ? "INTERRUPTED" : "AWAITING_PREVIEW_APPROVAL",
  );
  expect(
    (await p.pending()).filter((v) => v.kind === "generation_field"),
  ).toHaveLength(boundary === "role_response" ? 0 : 1);
}, 30000);

it.each([
  2200, 2201,
])("generation field is bounded by Unicode codepoints, including %s astral characters", async (length) => {
  const p = await setup({ generation: "𠀀".repeat(length) });
  const task = value(await p.compile());
  await p.handle(task.id);
  const saved = value(
    await p.service.getIdeationTask(p.actor, { taskId: task.id }),
  );
  expect(saved.status).toBe(
    length === 2200 ? "AWAITING_PREVIEW_APPROVAL" : "FAILED",
  );
  const previews = await p.pending();
  expect(previews).toHaveLength(length === 2200 ? 1 : 0);
  if (previews[0]?.kind === "generation_field")
    expect(previews[0].characterCount).toBe(2200);
}, 30000);

it("compiler cannot invent locked commitments and source/state changes block admission or approval without writes", async () => {
  const p = await setup({ invent: true });
  const id = value(await p.compile()).id;
  await p.handle(id);
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: id })).status,
  ).toBe("FAILED");
  expect(await p.pending()).toHaveLength(0);
  const q = await setup();
  const task = value(await q.compile());
  await q.handle(task.id);
  const preview = (await q.pending())[0];
  if (!preview) throw new Error("preview");
  await q.fs.write(state.STATE, `${await q.fs.readText(state.STATE)}\n`);
  expect(
    value(await q.service.getPreview(q.actor, { previewId: preview.id }))
      .status,
  ).toBe("stale");
  expect(await q.approve(preview)).toMatchObject({
    ok: false,
    error: { code: "PREVIEW_STALE" },
  });
  const current = await state.loadState(q.fs);
  current.pending_consolidation = true;
  await state.saveState(q.fs, current);
  expect(await q.compile()).toMatchObject({
    ok: false,
    error: { code: "PRECONDITION_FAILED" },
  });
}, 30000);

it("compilation locators enforce foreign-session and resource ownership before status/billing, and stale expected hashes do not create tasks", async () => {
  const p = await setup(),
    q = await setup();
  expect(await p.compile({ sessionId: q.session.id })).toMatchObject({
    ok: false,
    error: { code: "NOT_FOUND" },
  });
  expect(
    await q.service.requestIdeationCompilation(q.actor, {
      sessionId: p.session.id,
      chapter: "001",
      scope: { volume: null, arc: null, scene_type: null, pov: null },
      sources: [],
      clientRequestId: randomUUID() as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(
    await p.compile({
      sources: [
        { resourceId: "foreign-only-resource", expectedSha256: "0".repeat(64) },
      ],
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(
    await p.compile({
      sources: [
        { resourceId: "gushi-dangqian-hu", expectedSha256: "0".repeat(64) },
      ],
    }),
  ).toMatchObject({ ok: false, error: { code: "RESOURCE_STALE" } });
  expect(
    await p.compile({
      sources: [
        {
          resourceId: "biaoxian-xiangmu-shengyin",
          expectedSha256: await p.fs.sha256("表现/项目声音.md"),
        },
      ],
    }),
  ).toMatchObject({ ok: false, error: { code: "READERS_DENIED" } });
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_tasks WHERE project_id=$1",
        [p.actor.projectId],
      )
    ).rowCount,
  ).toBe(0);
  expect(p.requests).toHaveLength(0);
}, 30000);

it.each([
  "role_response",
  "role_completed",
])("trial SIGKILL at %s preserves the candidate and never fabricates or repeats trial evidence", async (boundary) => {
  const p = await setup(),
    preview = await p.proposal();
  const id = value(await p.approve(preview)).startedTaskId;
  if (!id) throw new Error("trial");
  const count = p.requests.length;
  await killIdeationAt(
    p.db,
    p.actor.projectId,
    {
      kind: "ideation",
      projectId: p.actor.projectId,
      ownerId: p.actor.userId,
      runId: id,
    },
    boundary,
    inject("databaseUrl"),
    p.worker.queue,
  );
  await p.handle(id);
  expect(p.requests).toHaveLength(count);
  expect(
    (await registry.readRegistry(p.fs)).resources.find(
      (r) => r.id === preview.resource.id,
    )?.status,
  ).toBe("candidate");
  expect(
    (await p.pending()).filter(
      (v) =>
        v.kind === "expression_candidate" && v.approvalStage === "activation",
    ),
  ).toHaveLength(boundary === "role_response" ? 0 : 1);
}, 30000);

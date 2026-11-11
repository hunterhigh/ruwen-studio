import { randomUUID } from "node:crypto";
import {
  createFauxRuntime,
  type Data,
  fauxOutput,
  type ModelRuntime,
  readAuthorizedResource,
} from "@ruwen/agents";
import { packet, registry, state } from "@ruwen/core";
import type {
  IdeationActor,
  IdeationCreateVerbatimPreview,
  IdeationResult,
  IdeationVerbatimPreview,
} from "@ruwen/pipeline";
import {
  approveCandidate,
  startChapter,
  withIdeationV1_2,
} from "@ruwen/pipeline";
import { afterEach, expect, it } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import {
  ensureExactTextChapter,
  exactBindingPath,
} from "../../../packages/pipeline/src/ideation/exact-text.ts";
import {
  assertNoOriginalWording,
  OriginalWordingStream,
} from "../../../packages/pipeline/src/ideation/privacy.ts";
import { downstreamOriginalSources } from "../../../packages/pipeline/src/ideation/published.ts";
import { IdeationServiceBackend } from "../../../packages/pipeline/src/ideation/specialized.ts";
import type { IdeationTransaction } from "../../../packages/pipeline/src/ideation/store.ts";
import {
  createIdeationService,
  createIdeationServiceV1_2,
} from "../src/ideation-service.ts";
import { fixture } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
function value<T>(r: IdeationResult<T>): T {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}
const selected = "PUBLISHED_SENTINEL_春水越过石阶而来_甲乙丙丁戊己庚辛";
const remainder = "PRIVATE_REMAINDER_同一消息未选取的原话_壬癸子丑寅卯辰巳";
const target = {
  kind: "resource_file",
  resourceId: "shijie-dangqian-taishi",
} as const;
async function setup(
  content = `${selected}。${remainder}`,
  runtime: () => ModelRuntime = createFauxRuntime,
) {
  const p = await fixture({ runtime });
  cleanup.push(() => p.service.stop());
  const actor = {
    projectId: p.fs.projectId,
    userId: p.fs.ownerId,
  } as IdeationActor;
  const options = { queue: p.service.queue, modelMode: "faux" as const };
  const old = createIdeationService(p.service.db, options),
    service = createIdeationServiceV1_2(p.service.db, options);
  const session = value(
    await service.createIdeationSession(actor, {
      clientRequestId: randomUUID() as never,
    }),
  );
  const accepted = value(
    await service.sendIdeationMessage(actor, {
      sessionId: session.id,
      expectedSessionRevision: 0,
      content,
      clientRequestId: randomUUID() as never,
    }),
  );
  const request = (
    end = Array.from(selected).length,
  ): IdeationCreateVerbatimPreview => ({
    messageId: accepted.messageId,
    start: 0,
    end,
    target: target as never,
    clientRequestId: randomUUID() as never,
  });
  const approve = (preview: IdeationVerbatimPreview) => ({
    previewId: preview.id,
    expectedSha256: preview.sha256,
    confirmed: true as const,
    clientRequestId: randomUUID() as never,
  });
  return {
    ...p,
    db: p.service.db,
    worker: p.service,
    actor,
    old,
    service,
    session,
    accepted,
    request,
    approve,
  };
}

it("creates immutable user-only selection previews idempotently, without writing files, new tasks or charges", async () => {
  const p = await setup(
    "😀逐字内容_一二三四五六七八九十。未选择的内容仍在会话中。",
  );
  const before = await p.fs.sha256("世界/当前态势.md");
  const counts = async () =>
    (
      await p.db.pool.query(
        "SELECT (SELECT count(*) FROM pipeline_runs WHERE project_id=$1)::text AS tasks,(SELECT count(*) FROM credit_ledger WHERE user_id=$2)::text AS ledger",
        [p.actor.projectId, p.actor.userId],
      )
    ).rows[0];
  const initial = await counts(),
    request = { ...p.request(10), start: 1 };
  const preview = value(
    await p.service.createVerbatimPreview(p.actor, request),
  );
  expect(preview).toMatchObject({
    kind: "verbatim",
    taskId: null,
    origin: "user_explicit",
    text: Array.from(
      "😀逐字内容_一二三四五六七八九十。未选择的内容仍在会话中。",
    )
      .slice(1, 10)
      .join(""),
  });
  expect(
    value(await p.service.createVerbatimPreview(p.actor, request)),
  ).toEqual(preview);
  expect(await counts()).toEqual(initial);
  expect(await p.fs.sha256("世界/当前态势.md")).toBe(before);
  expect(
    value(await p.old.listPreviews(p.actor, { sessionId: p.session.id })).items,
  ).toEqual([]);
  expect(
    value(await p.service.listPreviews(p.actor, { sessionId: p.session.id }))
      .items,
  ).toHaveLength(1);
  expect(
    JSON.stringify(
      value(
        await p.service.listIdeationEvents(p.actor, {
          sessionId: p.session.id,
        }),
      ),
    ),
  ).not.toContain(preview.text);
  expect(
    await p.service.createVerbatimPreview(p.actor, {
      ...request,
      content: "model supplied",
    } as never),
  ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  await expect(
    p.db.pool.query("UPDATE ideation_previews SET snapshot='{}' WHERE id=$1", [
      preview.id,
    ]),
  ).rejects.toThrow();
}, 30000);

it("checks every parent and target before range/status/idempotence; invalid own selections are 400", async () => {
  const p = await setup(),
    q = await setup();
  for (const actor of [q.actor, { ...p.actor, userId: q.actor.userId }])
    expect(
      await p.service.createVerbatimPreview(actor, {
        ...p.request(),
        start: -1,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(
    await p.service.createVerbatimPreview(p.actor, {
      ...p.request(),
      messageId: q.accepted.messageId,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  expect(
    await p.service.createVerbatimPreview(p.actor, {
      ...p.request(),
      target: {
        kind: "resource_file",
        resourceId: "missing-other-project",
      } as never,
      start: -1,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  for (const [start, end] of [
    [-1, 3],
    [0, 10000],
    [2, 2],
    [2, 1],
    [0, 1.5],
    [NaN, 3],
  ])
    expect(
      await p.service.createVerbatimPreview(p.actor, {
        ...p.request(),
        start: start as number,
        end: end as number,
      }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  const assistant = randomUUID();
  await p.db.pool.query(
    "INSERT INTO ideation_messages(id,project_id,session_id,role,content,session_revision) VALUES($1,$2,$3,'assistant',$4,1)",
    [
      assistant,
      p.actor.projectId,
      p.session.id,
      JSON.stringify("不能选助手文字"),
    ],
  );
  expect(
    await p.service.createVerbatimPreview(p.actor, {
      ...p.request(),
      messageId: assistant as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  const preview = value(
    await p.service.createVerbatimPreview(p.actor, p.request()),
  );
  for (const actor of [q.actor, { ...p.actor, userId: q.actor.userId }]) {
    for (const result of [
      await p.service.getPreview(actor, { previewId: preview.id }),
      await p.service.approvePreview(actor, p.approve(preview)),
      await p.service.rejectPreview(actor, { ...p.approve(preview) }),
      await p.service.listPreviews(actor, { sessionId: p.session.id }),
    ])
      expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  }
}, 30000);

it("publishes only approved resource selections; readers can use them while the rest of the same message remains blocked", async () => {
  const p = await setup(),
    before = await p.fs.readText("世界/当前态势.md");
  const preview = value(
    await p.service.createVerbatimPreview(p.actor, p.request()),
  );
  const raw = () =>
    p.old.store.transaction(p.actor, (tx) =>
      downstreamOriginalSources(tx, p.actor, p.session.id),
    );
  expect(() => assertNoOriginalWording(selected, [selected])).toThrow(
    "OUTPUT_BLOCKED",
  );
  const pendingRaw = await raw();
  expect(() => assertNoOriginalWording(selected, pendingRaw)).toThrow(
    "OUTPUT_BLOCKED",
  );
  const request = p.approve(preview),
    receipt = value(await p.service.approvePreview(p.actor, request));
  expect(value(await p.service.approvePreview(p.actor, request))).toEqual(
    receipt,
  );
  expect(
    await p.service.approvePreview(p.actor, p.approve(preview)),
  ).toMatchObject({ ok: false, error: { code: "ALREADY_DECIDED" } });
  expect(
    await p.service.approvePreview(p.actor, {
      ...request,
      expectedSha256: "f".repeat(64) as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
  expect(await p.fs.readText("世界/当前态势.md")).toBe(
    before + (before.endsWith("\n") ? "" : "\n") + selected,
  );
  const sources = await raw(),
    context = {
      fs: p.fs,
      projectKey: "demo-ruwen",
      runtime: createFauxRuntime(),
      onResourceRead: (r: unknown) => assertNoOriginalWording(r, sources),
    };
  const read = await readAuthorizedResource(
    context,
    "xiangmu-zhiliyuan",
    target.resourceId,
  );
  expect(read.content).toContain(selected);
  expect(() =>
    assertNoOriginalWording({ content: selected }, sources),
  ).not.toThrow();
  expect(() =>
    assertNoOriginalWording({ content: remainder }, sources),
  ).toThrow("OUTPUT_BLOCKED");
  await expect(
    readAuthorizedResource(context, "qinggan-duzhe", target.resourceId),
  ).rejects.toThrow();
  let text = "";
  const stream = new OriginalWordingStream(sources, (part) => {
    text += part;
  });
  expect(stream.push(selected)).toBe(true);
  stream.finish();
  expect(text).toBe(selected);
  expect(
    (
      await p.db.pool.query(
        "SELECT start_position,end_position FROM ideation_published_selections WHERE preview_id=$1",
        [preview.id],
      )
    ).rows,
  ).toEqual([{ start_position: 0, end_position: Array.from(selected).length }]);
  expect(
    value(
      await p.service.getIdeationApproval(p.actor, { decisionId: receipt.id }),
    ),
  ).toEqual(receipt);
  expect(
    JSON.stringify(
      value(
        await p.service.listIdeationEvents(p.actor, {
          sessionId: p.session.id,
        }),
      ),
    ),
  ).not.toContain(selected);
}, 30000);

it("requires confirmation/server hashes and refuses changed source or target without publishing", async () => {
  const p = await setup();
  const preview = value(
    await p.service.createVerbatimPreview(p.actor, p.request()),
  );
  expect(
    await p.service.approvePreview(p.actor, {
      ...p.approve(preview),
      confirmed: false,
    } as never),
  ).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
  expect(
    await p.service.approvePreview(p.actor, {
      ...p.approve(preview),
      expectedSha256: "0".repeat(64) as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "PREVIEW_STALE" } });
  await p.db.pool.query(
    "UPDATE ideation_messages SET content=to_jsonb((content #>> '{}') || '已变更') WHERE id=$1",
    [p.accepted.messageId],
  );
  expect(
    await p.service.approvePreview(p.actor, p.approve(preview)),
  ).toMatchObject({ ok: false, error: { code: "PREVIEW_STALE" } });
  expect(
    value(
      await p.service.listPreviews(p.actor, {
        sessionId: p.session.id,
        status: "pending",
      }),
    ).items,
  ).toEqual([]);
  expect(
    value(
      await p.service.listPreviews(p.actor, {
        sessionId: p.session.id,
        status: "stale",
      }),
    ).items.map((p) => p.id),
  ).toContain(preview.id);
  const next = value(
    await p.service.createVerbatimPreview(p.actor, p.request()),
  );
  const file = "世界/当前态势.md",
    changed = `${await p.fs.readText(file)}\n目标文件另有新版本。`;
  await p.fs.write(file, changed);
  expect(
    await p.service.approvePreview(p.actor, p.approve(next)),
  ).toMatchObject({ ok: false, error: { code: "PREVIEW_STALE" } });
  expect(await p.fs.readText(file)).toBe(changed);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_published_selections WHERE project_id=$1",
        [p.actor.projectId],
      )
    ).rowCount,
  ).toBe(0);
}, 30000);

it("full faux coordinator → publication → approved handoff → downstream preview uses published material without the remaining private text", async () => {
  const downstream: string[] = [];
  const runtime = createFauxRuntime(
    Array.from({ length: 20 }, () => (context) => {
      const response = defaultFauxResponse(context),
        role = requestRole(context);
      if (role === "chuangyi-xietiaoyuan") {
        const clean = fauxOutput(role, {
          project_state: { project: "demo-ruwen" },
        }) as Data;
        clean.recipient = "xiangmu-zhiliyuan";
        clean.resource_ids = [target.resourceId];
        return {
          ...response,
          content: [
            {
              type: "toolCall",
              id: randomUUID(),
              name: "propose_handoff",
              arguments: clean,
            },
          ],
          stopReason: "toolUse",
        };
      }
      downstream.push(JSON.stringify(context));
      if (
        !context.messages.some(
          (m) => m.role === "toolResult" && m.toolName === "read_resource",
        )
      )
        return {
          ...response,
          content: [
            {
              type: "toolCall",
              id: randomUUID(),
              name: "read_resource",
              arguments: { id: target.resourceId },
            },
          ],
          stopReason: "toolUse",
        };
      return {
        ...response,
        content: [
          { type: "text", text: `引用已批准资料：${selected}` },
          {
            type: "toolCall",
            id: randomUUID(),
            name: "submit_governance_preview",
            arguments: {
              changes: [],
              conflicts: [],
              scope_changes: [],
              writes_requested: [],
              patches: [],
              new_files: [
                {
                  resource_id: "published-copy",
                  path: "世界/已发布引用.md",
                  type: "world",
                  content: `# 已批准资料引用\n\n${selected}\n`,
                },
              ],
            },
          },
        ],
        stopReason: "toolUse",
      };
    }),
  );
  const p = await setup(undefined, () => runtime);
  const verbatim = value(
    await p.service.createVerbatimPreview(p.actor, p.request()),
  );
  value(await p.service.approvePreview(p.actor, p.approve(verbatim)));
  const handle = (runId: string) =>
    p.worker.handle({
      kind: "ideation",
      projectId: p.actor.projectId,
      ownerId: p.actor.userId,
      runId,
    });
  await handle(p.accepted.turnId);
  const handoff = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items.find((p) => p.kind === "handoff");
  if (!handoff) throw new Error("handoff");
  expect(JSON.stringify(handoff)).not.toContain(selected);
  const receipt = value(
    await p.service.approvePreview(p.actor, {
      previewId: handoff.id,
      expectedSha256: handoff.sha256,
      confirmed: true,
      clientRequestId: randomUUID() as never,
    }),
  );
  if (!receipt.startedTaskId) throw new Error("dispatch");
  await handle(receipt.startedTaskId);
  const task = value(
    await p.service.getIdeationTask(p.actor, { taskId: receipt.startedTaskId }),
  );
  expect(task.status).toBe("AWAITING_PREVIEW_APPROVAL");
  const file = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items.find((p) => p.kind === "file_patch");
  expect(JSON.stringify(file)).toContain(selected);
  expect(JSON.stringify(file)).not.toContain(remainder);
  expect(downstream.some((c) => c.includes(selected))).toBe(true);
  expect(downstream.every((c) => !c.includes(remainder))).toBe(true);
  const frames = value(
    await p.service.listIdeationEvents(p.actor, { sessionId: p.session.id }),
  ).items.filter((e) => e.type === "delta" && e.role === "xiangmu-zhiliyuan");
  expect(
    frames.map((e) => (e.type === "delta" ? e.text : "")).join(""),
  ).toContain(selected);
}, 30000);

it("an unavailable audit ledger rolls back files, approvals, registry, decisions and published ranges", async () => {
  const p = await setup(),
    preview = value(
      await p.service.createVerbatimPreview(p.actor, p.request()),
    );
  const before = await p.fs.sha256("世界/当前态势.md"),
    registryBefore = await p.fs.sha256(registry.REGISTRY),
    auditBefore = await p.fs.sha256("治理/审计账本.jsonl"),
    approvalsBefore = await p.fs.list("治理/审批");
  const unavailableLedger = (tx: IdeationTransaction): IdeationTransaction =>
    new Proxy(tx, {
      get(target, key) {
        if (key === "transaction")
          return (fn: (inner: IdeationTransaction) => Promise<unknown>) =>
            target.transaction((inner) =>
              fn(unavailableLedger(inner as IdeationTransaction)),
            );
        if (key === "write")
          return async (path: string, data: Uint8Array | string) => {
            if (path === "治理/审计账本.jsonl")
              throw new Error("audit unavailable");
            return target.write(path, data);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  const backend = new IdeationServiceBackend(
    {
      transaction: (actor, operation) =>
        p.old.store.transaction(actor, (tx) =>
          operation(unavailableLedger(tx)),
        ),
    },
    p.old.options,
  );
  expect(
    await withIdeationV1_2(backend).approvePreview(p.actor, p.approve(preview)),
  ).toMatchObject({ ok: false, error: { code: "INTERNAL_ERROR" } });
  expect(await p.fs.sha256("世界/当前态势.md")).toBe(before);
  expect(await p.fs.sha256(registry.REGISTRY)).toBe(registryBefore);
  expect(await p.fs.sha256("治理/审计账本.jsonl")).toBe(auditBefore);
  expect(await p.fs.list("治理/审批")).toEqual(approvalsBefore);
  expect(
    value(await p.service.getPreview(p.actor, { previewId: preview.id }))
      .status,
  ).toBe("pending");
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_published_selections WHERE project_id=$1",
        [p.actor.projectId],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_decisions WHERE preview_id=$1",
        [preview.id],
      )
    ).rowCount,
  ).toBe(0);
}, 30000);

it("current-chapter exact text has a 600-codepoint ceiling, enters the bounded real packet, and is cleared on canonical approval", async () => {
  const raw = `${"章".repeat(600)}未发布的本章私有剩余文字甲乙丙丁戊己庚辛壬癸`;
  const p = await setup(raw);
  const request = {
    ...p.request(600),
    target: { kind: "current_chapter" as const },
  };
  expect(
    await p.service.createVerbatimPreview(p.actor, { ...request, end: 601 }),
  ).toMatchObject({ ok: false, error: { code: "INPUT_LIMIT_EXCEEDED" } });
  const preview = value(
    await p.service.createVerbatimPreview(p.actor, request),
  );
  if (preview.target.kind !== "current_chapter") throw new Error("target");
  expect(await p.fs.exists(preview.target.file.path)).toBe(false);
  value(await p.service.approvePreview(p.actor, p.approve(preview)));
  const compiled = await packet.compilePacket(
      p.fs,
      preview.target.manifest.path,
    ),
    body = await p.fs.readText(compiled.output);
  expect(body).toContain("章".repeat(600));
  expect(Array.from(body).length).toBeLessThanOrEqual(8000);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_published_selections WHERE project_id=$1",
        [p.actor.projectId],
      )
    ).rowCount,
  ).toBe(0);
  const sources = await p.old.store.transaction(p.actor, (tx) =>
    downstreamOriginalSources(tx, p.actor, p.session.id),
  );
  expect(() => assertNoOriginalWording("章".repeat(20), sources)).toThrow(
    "OUTPUT_BLOCKED",
  );
  const ctx = {
    projectKey: "demo-ruwen",
    runtime: createFauxRuntime(),
    deferMemory: true,
  };
  const run = await startChapter(p.fs, { chapter: "001" }, ctx);
  expect(run.status).toBe("AWAITING_CANDIDATE_APPROVAL");
  await approveCandidate(
    p.fs,
    run.id,
    { confirmed: true, expectedSha256: run.candidateSha256 ?? "" },
    ctx,
  );
  expect(
    JSON.parse(await p.fs.readText(preview.target.manifest.path))
      .user_authored_text,
  ).toBeNull();
  expect(
    JSON.parse(await p.fs.readText(exactBindingPath(preview.target.file.path)))
      .active,
  ).toBe(false);
  const manifest = JSON.parse(
    await p.fs.readText(preview.target.manifest.path),
  );
  manifest.user_authored_text = {
    path: preview.target.file.path,
    confirmed_verbatim: true,
  };
  await p.fs.write(preview.target.manifest.path, JSON.stringify(manifest));
  await ensureExactTextChapter(p.fs, preview.target.manifest.path, "002");
  expect(
    JSON.parse(await p.fs.readText(preview.target.manifest.path))
      .user_authored_text,
  ).toBeNull();
}, 30000);

it("rejects a total packet overflow using real core and leaves no unapproved files", async () => {
  const p = await setup("字".repeat(500));
  const field = "authoring-ruwen-v5/projections/current.md",
    content = (await p.fs.readText(field)).trim();
  await p.fs.write(
    field,
    content + "雨".repeat(2100 - Array.from(content).length),
  );
  const scope = JSON.parse(
    await p.fs.readText("authoring-ruwen-v5/manifests/author-manifest.json"),
  ).context_scope;
  await state.registerProjection(p.fs, field, "001", scope);
  const manifestPath = "authoring-ruwen-v5/manifests/author-manifest.json",
    base = await packet.compilePacket(p.fs, manifestPath),
    size = Array.from(await p.fs.readText(base.output)).length;
  const manifest = JSON.parse(await p.fs.readText(manifestPath));
  manifest.maximum_context_characters = Math.max(3000, size + 30);
  expect(manifest.maximum_context_characters).toBeGreaterThanOrEqual(3000);
  expect(manifest.maximum_context_characters).toBeLessThanOrEqual(8000);
  await p.fs.write(manifestPath, JSON.stringify(manifest));
  const before = await p.fs.sha256(manifestPath);
  expect(
    await p.service.createVerbatimPreview(p.actor, {
      ...p.request(500),
      target: { kind: "current_chapter" },
    }),
  ).toMatchObject({ ok: false, error: { code: "INPUT_LIMIT_EXCEEDED" } });
  expect(await p.fs.sha256(manifestPath)).toBe(before);
  expect(await p.fs.list("authoring-ruwen-v5/exact-text")).toEqual([]);
}, 30000);

it("a model attempting the nonexistent verbatim tool cannot create a user selection preview", async () => {
  let selection: Data = {},
    denied = false;
  const runtime = createFauxRuntime([
    (context) => {
      const names = context.messages.flatMap((m) =>
        m.role === "system" ? (m.toolsAdded ?? []).map((t) => t.name) : [],
      );
      expect(names).not.toContain("create_verbatim_preview");
      return {
        ...defaultFauxResponse(context),
        content: [
          {
            type: "toolCall",
            id: randomUUID(),
            name: "create_verbatim_preview",
            arguments: selection,
          },
        ],
        stopReason: "toolUse",
      };
    },
    (context) => {
      denied = context.messages.some(
        (m) =>
          m.role === "toolResult" &&
          m.toolName === "create_verbatim_preview" &&
          m.isError,
      );
      return {
        ...defaultFauxResponse(context),
        content: [
          { type: "text", text: "请选择需要保留的片段，再显式确认写入。" },
        ],
        stopReason: "stop",
      };
    },
  ]);
  const p = await setup(undefined, () => runtime);
  selection = p.request() as unknown as Data;
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: p.accepted.turnId,
  });
  expect(denied).toBe(true);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_previews WHERE project_id=$1 AND kind='verbatim'",
        [p.actor.projectId],
      )
    ).rowCount,
  ).toBe(0);
}, 30000);

it("closed sessions may select existing user text, reject once, and cannot revise a verbatim preview into a model turn", async () => {
  const p = await setup();
  value(
    await p.service.closeIdeationSession(p.actor, {
      sessionId: p.session.id,
      clientRequestId: randomUUID() as never,
    }),
  );
  const preview = value(
    await p.service.createVerbatimPreview(p.actor, p.request()),
  );
  expect(
    await p.service.revisePreview(p.actor, {
      ...p.approve(preview),
      content: "直接改写",
    }),
  ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  const { confirmed: _confirmed, ...approval } = p.approve(preview);
  const request = {
    ...approval,
    reason: "仅作为会话备注，不发送下游。",
  };
  value(await p.service.rejectPreview(p.actor, request));
  value(await p.service.rejectPreview(p.actor, request));
  expect(
    value(await p.service.getPreview(p.actor, { previewId: preview.id }))
      .status,
  ).toBe("rejected");
  expect(
    value(
      await p.service.listIdeationTasks(p.actor, { sessionId: p.session.id }),
    ).items,
  ).toHaveLength(1);
}, 30000);

import { randomUUID } from "node:crypto";
import {
  createFauxRuntime,
  type Data,
  fauxOutput,
  type RoleId,
  type SearchProvider,
} from "@ruwen/agents";
import { approval, ledgers, registry } from "@ruwen/core";
import type {
  IdeationActor,
  IdeationPreview,
  IdeationResult,
} from "@ruwen/pipeline";
import { afterEach, expect, inject, it } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import { IdeationWorkflow } from "../../../packages/pipeline/src/ideation/workflow.ts";
import { createIdeationService } from "../src/ideation-service.ts";
import { fixture } from "./helpers.ts";
import { killIdeationAt } from "./ideation-fault.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
function value<T>(r: IdeationResult<T>): T {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}
function clean(recipient: RoleId) {
  const v = fauxOutput("chuangyi-xietiaoyuan", {
    project_state: { project: "demo-ruwen" },
  }) as Data;
  v.recipient = recipient;
  return v;
}
async function setup(
  recipient: RoleId = "gushi-gousishi",
  options: {
    patch?: boolean;
    external?: boolean;
    search?: SearchProvider;
    newFile?: {
      resource_id: string;
      path: string;
      type: string;
      content: string;
    };
  } = {},
) {
  const requests: { role: RoleId; context: string }[] = [];
  let beforeHash = "";
  const runtime = createFauxRuntime(
    Array.from({ length: 100 }, () => (context) => {
      const role = requestRole(context);
      requests.push({ role, context: JSON.stringify(context) });
      const response = defaultFauxResponse(context);
      if (role === "waibu-zhishi-guwen") {
        const research = JSON.stringify(context.messages).includes(
          'field=\\"approved_learning_plan\\"',
        );
        const tools = context.messages.flatMap((m) =>
          m.role === "system" ? (m.toolsAdded ?? []).map((t) => t.name) : [],
        );
        expect(tools.includes("web_search")).toBe(
          Boolean(research && options.search),
        );
        if (
          research &&
          options.search &&
          !context.messages.some(
            (m) => m.role === "toolResult" && m.toolName === "web_search",
          )
        )
          return {
            ...response,
            content: [
              {
                type: "toolCall",
                id: randomUUID(),
                name: "web_search",
                arguments: { query: "驿站制度" },
              },
            ],
            stopReason: "toolUse",
          };
      }
      if (role === "chuangyi-xietiaoyuan") {
        const output = clean(recipient);
        if (options.external) {
          output.kind = "consultant_brief";
          output.payload = {
            known: "现有材料不足以回答这一问题。",
            unknown: "相关制度在具体环境中的适用条件。",
            learning_goal: "核对与当前项目有关的外部制度事实。",
            boundary: "只提供证据，不决定正典。",
            allowed_sources: ["external_search"],
            destination: "研究/构思/",
          };
        }
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
      if (options.patch && role === "xiangmu-zhiliyuan") {
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
                arguments: { id: "shijie-dangqian-taishi" },
              },
            ],
            stopReason: "toolUse",
          };
        return {
          ...response,
          content: [
            {
              type: "toolCall",
              id: randomUUID(),
              name: "submit_governance_preview",
              arguments: {
                changes: ["调整当前态势。"],
                conflicts: [],
                scope_changes: [],
                writes_requested: [],
                patches: [
                  {
                    path: "世界/当前态势.md",
                    base_sha256: beforeHash,
                    sections: [
                      {
                        heading: "## 活跃力量与各自运动",
                        replacement:
                          "两座城仍在争夺粮道，驿吏已经把封条压在桌边。\n\n",
                      },
                    ],
                  },
                ],
              },
            },
          ],
          stopReason: "toolUse",
        };
      }
      if (options.newFile && role === "xiangmu-zhiliyuan") {
        return {
          ...response,
          content: [
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
                new_files: [options.newFile],
              },
            },
          ],
          stopReason: "toolUse",
        };
      }
      return response;
    }),
  );
  const p = await fixture({
    runtime: () => runtime,
    ideation: options.search ? { search: options.search } : {},
  });
  cleanup.push(() => p.service.stop());
  beforeHash = await p.fs.sha256("世界/当前态势.md");
  const actor = {
    userId: p.fs.ownerId,
    projectId: p.fs.projectId,
  } as IdeationActor;
  const service = createIdeationService(p.service.db, {
    modelMode: "faux",
    queue: p.service.queue,
    ...(options.search ? { search: options.search } : {}),
  });
  const session = value(
    await service.createIdeationSession(actor, {
      clientRequestId: randomUUID() as never,
    }),
  );
  const raw =
    "RAW_USER_ONLY_必须始终留在协调员消息表中的独特原始措辞甲乙丙丁戊己";
  const accepted = value(
    await service.sendIdeationMessage(actor, {
      sessionId: session.id,
      clientRequestId: randomUUID() as never,
      expectedSessionRevision: 0,
      content: raw,
    }),
  );
  const handle = (id: string) =>
    p.service.handle({
      kind: "ideation",
      projectId: actor.projectId,
      ownerId: actor.userId,
      runId: id,
    });
  await handle(accepted.turnId);
  const handoff = value(
    await service.listPreviews(actor, { sessionId: session.id }),
  ).items[0];
  if (!handoff) throw new Error("missing handoff");
  return {
    ...p,
    worker: p.service,
    db: p.service.db,
    service,
    actor,
    session,
    raw,
    handoff,
    requests,
    handle,
    beforeHash,
  };
}
const approve = (
  p: Awaited<ReturnType<typeof setup>>,
  preview: IdeationPreview,
) =>
  p.service.approvePreview(p.actor, {
    previewId: preview.id,
    expectedSha256: preview.sha256,
    confirmed: true,
    clientRequestId: randomUUID() as never,
  });

it.each([
  "xiangmu-zhiliyuan",
  "waibu-zhishi-guwen",
  "biaoxian-shejishi",
  "gushi-gousishi",
] as RoleId[])("approved %s dispatch runs once in fresh context and produces only an isolated pending preview", async (role) => {
  const p = await setup(role);
  const before = await p.fs.sha256("世界/当前态势.md");
  expect(p.requests.every((r) => r.role === "chuangyi-xietiaoyuan")).toBe(true);
  const request = {
    previewId: p.handoff.id,
    expectedSha256: p.handoff.sha256,
    confirmed: true as const,
    clientRequestId: randomUUID() as never,
  };
  const [a, b] = await Promise.all([
    p.service.approvePreview(p.actor, request),
    p.service.approvePreview(p.actor, request),
  ]);
  expect(a).toEqual(b);
  const receipt = value(a);
  expect(receipt.coreApprovals[0]?.action).toBe("handoff_execute");
  if (!receipt.startedTaskId) throw new Error("task");
  expect(
    await approval.eventIsCommitted(p.fs, String(receipt.coreApprovals[0]?.id)),
  ).toBe(true);
  await p.handle(receipt.startedTaskId);
  await p.handle(receipt.startedTaskId);
  const task = value(
    await p.service.getIdeationTask(p.actor, { taskId: receipt.startedTaskId }),
  );
  expect(task.status).toBe(
    role === "waibu-zhishi-guwen"
      ? "AWAITING_LEARNING_PLAN_APPROVAL"
      : "AWAITING_PREVIEW_APPROVAL",
  );
  const previews = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items;
  expect(previews).toHaveLength(1);
  expect(previews[0]?.kind).toBe(
    role === "waibu-zhishi-guwen"
      ? "learning_plan"
      : role === "biaoxian-shejishi"
        ? "expression_candidate"
        : "file_patch",
  );
  expect(
    p.requests.filter((r) => r.role !== "chuangyi-xietiaoyuan"),
  ).toHaveLength(1);
  for (const request of p.requests.filter(
    (r) => r.role !== "chuangyi-xietiaoyuan",
  )) {
    expect(request.context).not.toContain(p.raw);
    expect(request.context).not.toContain("raw_user_text");
    expect(request.context).not.toContain("conversation");
  }
  const exposed = {
    receipt,
    task,
    previews,
    events: value(
      await p.service.listIdeationEvents(p.actor, { sessionId: p.session.id }),
    ).items,
  };
  expect(JSON.stringify(exposed)).not.toContain(p.raw);
  expect(await p.fs.sha256("世界/当前态势.md")).toBe(before);
  expect(
    await p.service.approvePreview(p.actor, {
      ...request,
      clientRequestId: randomUUID() as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "ALREADY_DECIDED" } });
}, 30000);

it("external search is absent during planning and available only in a separately approved investigation; replacing the parent hold works with exactly one reservation available", async () => {
  let searches = 0;
  const p = await setup("waibu-zhishi-guwen", {
    external: true,
    search: {
      search: async () => {
        searches++;
        return [
          {
            claim: "外部证据",
            source: "https://example.invalid/evidence",
            uncertainty: "仅测试",
          },
        ];
      },
    },
  });
  const parent = value(await approve(p, p.handoff)).startedTaskId;
  if (!parent) throw new Error("task");
  await p.handle(parent);
  expect(searches).toBe(0);
  const plan = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  if (!plan) throw new Error("plan");
  const hold = (
    await p.db.pool.query(
      "SELECT amount::text FROM credit_reservations WHERE run_id=$1",
      [parent],
    )
  ).rows[0];
  await p.db.pool.query(
    "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) SELECT $1,'sandbox',$2::bigint-coalesce(sum(delta_credits),0),'test_fixture','user',$3 FROM credit_ledger WHERE user_id=$1 AND bank='sandbox'",
    [p.actor.userId, hold?.amount, p.actor.userId],
  );
  const child = value(await approve(p, plan)).startedTaskId;
  if (!child) throw new Error("research");
  expect(
    (
      await p.db.pool.query(
        "SELECT status FROM credit_reservations WHERE run_id=$1",
        [parent],
      )
    ).rows[0]?.status,
  ).toBe("released");
  await p.handle(child);
  expect(searches).toBe(1);
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: child })).status,
  ).toBe("AWAITING_PREVIEW_APPROVAL");
}, 30000);

it("cancelling a pending preview releases known unused funds and blocks subsequent approval without undoing files or double settling", async () => {
  const p = await setup("xiangmu-zhiliyuan", { patch: true });
  const id = value(await approve(p, p.handoff)).startedTaskId;
  if (!id) throw new Error("task");
  await p.handle(id);
  const preview = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  if (!preview) throw new Error("preview");
  const req = { taskId: id, clientRequestId: randomUUID() as never };
  expect(value(await p.service.cancelIdeationTask(p.actor, req)).status).toBe(
    "CANCELLED",
  );
  value(await p.service.cancelIdeationTask(p.actor, req));
  await p.handle(id);
  expect(await approve(p, preview)).toMatchObject({
    ok: false,
    error: { code: "ALREADY_DECIDED" },
  });
  expect(await p.fs.sha256("世界/当前态势.md")).toBe(p.beforeHash);
  expect(
    (
      await p.db.pool.query(
        "SELECT status,remaining::text FROM credit_reservations WHERE run_id=$1",
        [id],
      )
    ).rows[0],
  ).toEqual({ status: "released", remaining: "0" });
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM credit_ledger l JOIN role_runs r ON r.id::text=l.ref_id WHERE r.run_id=$1 AND l.reason='role_usage'",
        [id],
      )
    ).rowCount,
  ).toBe(1);
}, 30000);

it("source changes persist stale previews before filtering and cannot consume an approval", async () => {
  const p = await setup("xiangmu-zhiliyuan", { patch: true });
  const id = value(await approve(p, p.handoff)).startedTaskId;
  if (!id) throw new Error("task");
  await p.handle(id);
  const preview = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  if (!preview) throw new Error("preview");
  await p.fs.write(
    "世界/当前态势.md",
    `${await p.fs.readText("世界/当前态势.md")}\n另一项已确认变化。\n`,
  );
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
    ).items.map((v) => v.id),
  ).toContain(preview.id);
  expect(await approve(p, preview)).toMatchObject({
    ok: false,
    error: { code: "PREVIEW_STALE" },
  });
}, 30000);

it.each([
  "治理/审批/forged.md",
  "世界/RAW_USER_ONLY_必须始终留在协调员消息表中的独特原始措辞甲乙丙丁戊己.md",
])("model-controlled new path %s cannot bypass reserved paths or original-wording isolation", async (path) => {
  const p = await setup("xiangmu-zhiliyuan", {
    newFile: {
      resource_id: "fresh-world",
      path,
      type: "world",
      content: "两城之间的道路仍可通行。",
    },
  });
  const id = value(await approve(p, p.handoff)).startedTaskId;
  if (!id) throw new Error("task");
  await p.handle(id);
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: id })).status,
  ).toBe("FAILED");
  expect(await p.fs.exists(path)).toBe(false);
  expect(
    value(
      await p.service.listPreviews(p.actor, {
        sessionId: p.session.id,
        status: "pending",
      }),
    ).items,
  ).toEqual([]);
}, 30000);

it.each([
  "role_response",
  "role_completed",
])("downstream SIGKILL at %s never reruns a model or repeats usage/preview persistence", async (boundary) => {
  const p = await setup("gushi-gousishi");
  const id = value(await approve(p, p.handoff)).startedTaskId;
  if (!id) throw new Error("task");
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
  await p.handle(id);
  expect(p.requests.length).toBe(count);
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: id })).status,
  ).toBe(
    boundary === "role_response" ? "INTERRUPTED" : "AWAITING_PREVIEW_APPROVAL",
  );
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_previews WHERE task_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(boundary === "role_response" ? 0 : 1);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM credit_ledger l JOIN role_runs r ON r.id::text=l.ref_id WHERE r.run_id=$1 AND l.reason='role_usage'",
        [id],
      )
    ).rowCount,
  ).toBe(boundary === "role_response" ? 0 : 1);
}, 30000);

it("file sections remain preview-only until approval; file, registry, activation evidence, audit and decision commit atomically and only once", async () => {
  const p = await setup("xiangmu-zhiliyuan", { patch: true });
  const receipt = value(await approve(p, p.handoff));
  if (!receipt.startedTaskId) throw new Error("task");
  await p.handle(receipt.startedTaskId);
  const preview = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  if (!preview || preview.kind !== "file_patch")
    throw new Error("patch preview");
  expect(preview.patches[0]?.kind).toBe("sections");
  expect(await p.fs.sha256("世界/当前态势.md")).toBe(p.beforeHash);
  const req = {
    previewId: preview.id,
    expectedSha256: preview.sha256,
    confirmed: true as const,
    clientRequestId: randomUUID() as never,
  };
  expect(
    await p.service.approvePreview(p.actor, {
      ...req,
      confirmed: false as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
  const hashes = await Promise.all(
    ["世界/当前态势.md", registry.REGISTRY, "治理/审计账本.jsonl"].map((path) =>
      p.fs.sha256(path),
    ),
  );
  const broken = new IdeationWorkflow(
    {
      transaction: (actor, operation) =>
        p.service.store.transaction(actor, (tx) =>
          operation(
            new Proxy(tx, {
              get(target, key) {
                if (key === "sql")
                  return (query: string, args: unknown[]) => {
                    if (query.startsWith("INSERT INTO ideation_decisions"))
                      throw new Error("Injected commit failure");
                    return target.sql(query, args);
                  };
                const property = Reflect.get(target, key);
                return typeof property === "function"
                  ? property.bind(target)
                  : property;
              },
            }),
          ),
        ),
    },
    p.service.options,
  );
  expect(await broken.approvePreview(p.actor, req)).toMatchObject({
    ok: false,
    error: { code: "INTERNAL_ERROR" },
  });
  expect(
    await Promise.all(
      ["世界/当前态势.md", registry.REGISTRY, "治理/审计账本.jsonl"].map(
        (path) => p.fs.sha256(path),
      ),
    ),
  ).toEqual(hashes);
  const applied = value(await p.service.approvePreview(p.actor, req));
  expect(applied.committedFiles).toHaveLength(1);
  expect(await p.fs.readText("世界/当前态势.md")).toContain("封条压在桌边");
  expect((await registry.validateRegistry(p.fs)).errors).toEqual([]);
  expect(
    (await ledgers.readEntries(p.fs, "治理/审计账本.jsonl")).at(-1)?.change,
  ).toBe("ideation_preview_committed");
  expect(await p.service.approvePreview(p.actor, req)).toEqual({
    ok: true,
    value: applied,
  });
  expect(
    value(
      await p.service.getIdeationApproval(p.actor, { decisionId: applied.id }),
    ),
  ).toEqual(applied);
}, 30000);

it("a new governed file is exclusively created only after approval with server-owned registry metadata", async () => {
  const p = await setup("xiangmu-zhiliyuan", {
    newFile: {
      resource_id: "new-world-system",
      path: "世界/系统/新制度.md",
      type: "world",
      content: "# 新制度\n\n两城之间的货物流通仍受山口积雪影响。\n",
    },
  });
  const id = value(await approve(p, p.handoff)).startedTaskId;
  if (!id) throw new Error("task");
  await p.handle(id);
  const preview = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  if (!preview || preview.kind !== "file_patch") throw new Error("preview");
  expect(await p.fs.exists("世界/系统/新制度.md")).toBe(false);
  value(await approve(p, preview));
  const resource = (await registry.readRegistry(p.fs)).resources.find(
    (r) => r.id === "new-world-system",
  );
  expect(resource).toMatchObject({
    path: "世界/系统/新制度.md",
    status: "active",
    owner: "xiangmu-zhiliyuan",
    allow_author: false,
  });
  expect((await registry.validateRegistry(p.fs)).errors).toEqual([]);
  for (const request of [{ after: 1 }, { after: ["0"] }, { limit: null }])
    expect(
      await p.service.listPreviews(p.actor, {
        sessionId: p.session.id,
        ...request,
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
  expect(
    await p.service.getPreview(p.actor, { previewId: [preview.id] } as never),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
}, 30000);

it("a failed reservation rolls back handoff snapshots, consumed approval and new task; no approval or stale hash can dispatch", async () => {
  const p = await setup();
  const files = await p.fs.list("治理/交接");
  const bad = createIdeationService(p.db, {
    modelMode: "faux",
    onRunAccepted: async () => "INSUFFICIENT_CREDITS",
  });
  const req = {
    previewId: p.handoff.id,
    expectedSha256: p.handoff.sha256,
    confirmed: true as const,
    clientRequestId: randomUUID() as never,
  };
  expect(await bad.approvePreview(p.actor, req)).toMatchObject({
    ok: false,
    error: { code: "INSUFFICIENT_CREDITS" },
  });
  expect(await p.fs.list("治理/交接")).toEqual(files);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_tasks WHERE project_id=$1",
        [p.actor.projectId],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    value(await p.service.getPreview(p.actor, { previewId: p.handoff.id }))
      .status,
  ).toBe("pending");
  expect(
    await p.service.approvePreview(p.actor, {
      ...req,
      expectedSha256: "0".repeat(64) as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "PREVIEW_STALE" } });
  expect(await p.fs.list("治理/交接")).toEqual(files);
}, 30000);

it("reject/revise store original reasons only in coordinator messages; closed sessions block revision; all decision mutations enforce ownership", async () => {
  const p = await setup(),
    q = await setup();
  const reason =
    "REJECTION_REASON_RAW_这句话不能复制进预览任务事件或审计甲乙丙丁";
  const req = {
    previewId: p.handoff.id,
    expectedSha256: p.handoff.sha256,
    clientRequestId: randomUUID() as never,
  };
  for (const actor of [q.actor, { ...p.actor, userId: q.actor.userId }]) {
    expect(
      await p.service.approvePreview(actor, { ...req, confirmed: true }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await p.service.rejectPreview(actor, { ...req, reason }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await p.service.revisePreview(actor, { ...req, content: reason }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  }
  const revised = value(
    await p.service.revisePreview(p.actor, { ...req, content: reason }),
  );
  await p.handle(revised.turnId);
  expect(
    value(await p.service.getPreview(p.actor, { previewId: p.handoff.id }))
      .status,
  ).toBe("superseded");
  const next = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  expect(next?.supersedesPreviewId).toBe(p.handoff.id);
  if (!next) throw new Error("preview");
  value(
    await p.service.closeIdeationSession(p.actor, {
      sessionId: p.session.id,
      clientRequestId: randomUUID() as never,
    }),
  );
  expect(
    await p.service.revisePreview(p.actor, {
      previewId: next.id,
      expectedSha256: next.sha256,
      content: "关闭后的修改",
      clientRequestId: randomUUID() as never,
    }),
  ).toMatchObject({ ok: false, error: { code: "SESSION_CLOSED" } });
  value(
    await p.service.rejectPreview(p.actor, {
      previewId: next.id,
      expectedSha256: next.sha256,
      reason,
      clientRequestId: randomUUID() as never,
    }),
  );
  expect(
    value(
      await p.service.listIdeationMessages(p.actor, {
        sessionId: p.session.id,
      }),
    ).items.filter((m) => m.content === reason),
  ).toHaveLength(2);
  expect(
    JSON.stringify(
      value(
        await p.service.listIdeationEvents(p.actor, {
          sessionId: p.session.id,
        }),
      ),
    ),
  ).not.toContain(reason);
  expect(
    JSON.stringify(
      (
        await p.db.pool.query(
          "SELECT snapshot FROM ideation_previews WHERE project_id=$1",
          [p.actor.projectId],
        )
      ).rows,
    ),
  ).not.toContain(reason);
  const decision = value(await approve(q, q.handoff));
  expect(
    await p.service.getIdeationApproval(p.actor, { decisionId: decision.id }),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
}, 30000);

it("learning plan approval is a separate gate; absent search keeps the plan pending without tasks or investigation", async () => {
  const p = await setup("waibu-zhishi-guwen", { external: true });
  const handed = value(await approve(p, p.handoff));
  if (!handed.startedTaskId) throw new Error("task");
  await p.handle(handed.startedTaskId);
  const plan = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  if (!plan || plan.kind !== "learning_plan") throw new Error("plan");
  expect(plan.sourceMode).toBe("external_search");
  const calls = p.requests.length;
  expect(await approve(p, plan)).toMatchObject({
    ok: false,
    error: { code: "SEARCH_UNAVAILABLE" },
  });
  expect(
    value(await p.service.getPreview(p.actor, { previewId: plan.id })).status,
  ).toBe("pending");
  expect(p.requests).toHaveLength(calls);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM ideation_tasks WHERE project_id=$1",
        [p.actor.projectId],
      )
    ).rowCount,
  ).toBe(2);
}, 30000);

it("approved investigation uses a separate task and evidence preview; evidence activation never grants author/story/compiler access", async () => {
  const p = await setup("waibu-zhishi-guwen");
  const first = value(await approve(p, p.handoff));
  if (!first.startedTaskId) throw new Error("task");
  await p.handle(first.startedTaskId);
  const plan = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  if (!plan) throw new Error("plan");
  const investigation = value(await approve(p, plan));
  if (!investigation.startedTaskId) throw new Error("research");
  await p.handle(investigation.startedTaskId);
  const report = value(
    await p.service.listPreviews(p.actor, {
      sessionId: p.session.id,
      status: "pending",
    }),
  ).items[0];
  if (!report || report.kind !== "file_patch") throw new Error("evidence");
  expect(await p.fs.list("研究/构思")).toEqual([]);
  value(await approve(p, report));
  const evidence = (await registry.readRegistry(p.fs)).resources.find(
    (r) => r.id === report.registryChanges[0]?.resourceId,
  );
  expect(evidence?.type).toBe("evidence");
  expect(evidence?.status).toBe("active");
  expect(evidence?.allow_author).toBe(false);
  expect(evidence?.readers).not.toContain("xiaoshuo-zuozhe");
  expect(evidence?.readers).not.toContain("gushi-gousishi");
  expect(evidence?.readers).not.toContain("zhangjie-qingjing-bianyiyuan");
}, 30000);

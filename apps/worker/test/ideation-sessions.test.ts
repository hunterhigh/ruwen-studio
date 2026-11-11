import { randomUUID } from "node:crypto";
import {
  type IdeationActor,
  type IdeationResult,
  ideationSse,
  type RunStartErrorCode,
} from "@ruwen/pipeline";
import { expect, it } from "vitest";
import {
  appendIdeationEvent,
  type IdeationSessions,
} from "../../../packages/pipeline/src/ideation/sessions.ts";
import { createIdeationService } from "../src/ideation-service.ts";
import { fixture } from "./helpers.ts";

function value<T>(result: IdeationResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const actorFor = (p: Awaited<ReturnType<typeof fixture>>) =>
  ({ userId: p.fs.ownerId, projectId: p.fs.projectId }) as IdeationActor;
async function session(
  service: IdeationSessions,
  actor: IdeationActor,
  title = "构思会话",
) {
  return value(
    await service.createIdeationSession(actor, {
      title,
      clientRequestId: randomUUID() as never,
    }),
  );
}

it("persists messages byte-for-byte, atomically accepts one turn, and replays idempotent mutations without snapshots of wording", async () => {
  const p = await fixture();
  try {
    const service = createIdeationService(p.service.db, { modelMode: "faux" }),
      actor = actorFor(p);
    const s = await session(service, actor),
      raw = "  原话哨兵🔒RAW_IDEATION_甲乙丙丁  \n";
    const request = {
      sessionId: s.id,
      expectedSessionRevision: 0,
      clientRequestId: randomUUID() as never,
      content: raw,
    };
    const [a, b] = await Promise.all([
      service.sendIdeationMessage(actor, request),
      service.sendIdeationMessage(actor, request),
    ]);
    expect(a).toEqual(b);
    const accepted = value(a);
    expect(
      value(await service.listIdeationMessages(actor, { sessionId: s.id }))
        .items[0]?.content,
    ).toBe(raw);
    expect(
      await service.sendIdeationMessage(actor, {
        ...request,
        clientRequestId: randomUUID() as never,
      }),
    ).toMatchObject({ ok: false, error: { code: "TURN_IN_PROGRESS" } });
    expect(
      await service.sendIdeationMessage(actor, {
        ...request,
        content: "同键不同内容",
      }),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(
      value(await service.getIdeationTask(actor, { taskId: accepted.turnId }))
        .usage.costUsd,
    ).toBeNull();
    const artifacts = await p.service.db.pool.query(
      "SELECT request FROM pipeline_runs WHERE id=$1",
      [accepted.turnId],
    );
    expect(JSON.stringify(artifacts.rows)).not.toContain(raw);
    expect(
      (
        await p.service.db.pool.query(
          "SELECT 1 FROM ideation_outbox WHERE run_id=$1",
          [accepted.turnId],
        )
      ).rowCount,
    ).toBe(1);
    const cancel = {
      taskId: accepted.turnId,
      clientRequestId: randomUUID() as never,
    };
    expect(value(await service.cancelIdeationTask(actor, cancel)).status).toBe(
      "CANCELLED",
    );
    expect(value(await service.cancelIdeationTask(actor, cancel)).status).toBe(
      "CANCELLED",
    );
  } finally {
    await p.service.stop();
  }
}, 30000);

it("lists scoped stable pages and status filters; close is idempotent, leaves queued work untouched, and rejects new input", async () => {
  const p = await fixture();
  try {
    const service = createIdeationService(p.service.db, { modelMode: "faux" }),
      actor = actorFor(p);
    const a = await session(service, actor, "甲"),
      b = await session(service, actor, "乙");
    const accepted = value(
      await service.sendIdeationMessage(actor, {
        sessionId: a.id,
        clientRequestId: randomUUID() as never,
        expectedSessionRevision: 0,
        content: "关闭前受理",
      }),
    );
    const close = { sessionId: a.id, clientRequestId: randomUUID() as never };
    const closed = await service.closeIdeationSession(actor, close);
    expect(value(closed).status).toBe("closed");
    expect(await service.closeIdeationSession(actor, close)).toEqual(closed);
    expect(
      value(
        await service.closeIdeationSession(actor, {
          ...close,
          clientRequestId: randomUUID() as never,
        }),
      ),
    ).toEqual(value(closed));
    const denial = await service.sendIdeationMessage(actor, {
      sessionId: a.id,
      clientRequestId: randomUUID() as never,
      expectedSessionRevision: 1,
      content: "关闭后禁止",
    });
    expect(denial).toMatchObject({
      ok: false,
      error: { code: "SESSION_CLOSED" },
    });
    expect(
      value(await service.getIdeationTask(actor, { taskId: accepted.turnId }))
        .status,
    ).toBe("QUEUED");
    const page = value(await service.listIdeationSessions(actor, { limit: 1 }));
    expect(page.items[0]?.id).toBe(a.id);
    expect(
      value(
        await service.listIdeationSessions(actor, {
          limit: 1,
          after: page.nextCursor ?? undefined,
        } as never),
      ).items[0]?.id,
    ).toBe(b.id);
    expect(
      value(
        await service.listIdeationSessions(actor, { status: "closed" }),
      ).items.map((x) => x.id),
    ).toEqual([a.id]);
    expect(
      value(
        await service.listIdeationSessions(actor, { status: "open" }),
      ).items.map((x) => x.id),
    ).toEqual([b.id]);
    expect(
      await service.listIdeationSessions(actor, { status: "invalid" as never }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    const again = createIdeationService(p.service.db, { modelMode: "faux" });
    expect(
      value(await again.getIdeationSession(actor, { sessionId: a.id })).status,
    ).toBe("closed");
  } finally {
    await p.service.stop();
  }
}, 30000);

it.each([
  "INSUFFICIENT_CREDITS",
  "ACCOUNT_FROZEN",
  "BILLING_DISABLED",
] as RunStartErrorCode[])("ownership precedes %s; rejected starts leave no message, task, outbox, reservation or charge", async (code) => {
  const p = await fixture();
  try {
    let guards = 0;
    const service = createIdeationService(p.service.db, {
        modelMode: "faux",
        beforeRun: async () => {
          guards++;
          return code;
        },
      }),
      actor = actorFor(p),
      s = await session(service, actor);
    const request = {
      sessionId: s.id,
      clientRequestId: randomUUID() as never,
      expectedSessionRevision: 0,
      content: "不应受理",
    };
    expect(
      await service.sendIdeationMessage(
        { ...actor, userId: randomUUID() as never },
        request,
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(guards).toBe(0);
    expect(await service.sendIdeationMessage(actor, request)).toMatchObject({
      ok: false,
      error: { code },
    });
    expect(guards).toBe(1);
    for (const table of [
      "pipeline_runs",
      "ideation_messages",
      "ideation_tasks",
      "ideation_events",
      "credit_ledger",
    ]) {
      const query =
        table === "credit_ledger"
          ? "SELECT 1 FROM credit_ledger WHERE user_id=$1 AND reason<>'signup'"
          : `SELECT 1 FROM ${table} WHERE project_id=$1`;
      expect(
        (
          await p.service.db.pool.query(query, [
            table === "credit_ledger" ? actor.userId : actor.projectId,
          ])
        ).rowCount,
      ).toBe(0);
    }
  } finally {
    await p.service.stop();
  }
}, 30000);

it("every session/task/event service checks foreign owners, mixed projects, invalid IDs, empty pages and idempotent branches", async () => {
  const p = await fixture(),
    q = await fixture();
  try {
    const service = createIdeationService(p.service.db, { modelMode: "faux" }),
      a = actorFor(p),
      b = actorFor(q),
      s = await session(service, a);
    const accepted = value(
      await service.sendIdeationMessage(a, {
        sessionId: s.id,
        clientRequestId: randomUUID() as never,
        expectedSessionRevision: 0,
        content: "租户私有内容",
      }),
    );
    const close = { sessionId: s.id, clientRequestId: randomUUID() as never };
    value(await service.closeIdeationSession(a, close));
    const operations: ((
      actor: IdeationActor,
    ) => Promise<IdeationResult<unknown>>)[] = [
      (x) => service.getIdeationSession(x, { sessionId: s.id }),
      (x) => service.closeIdeationSession(x, close),
      (x) => service.listIdeationMessages(x, { sessionId: s.id }),
      (x) =>
        service.sendIdeationMessage(x, {
          sessionId: s.id,
          clientRequestId: randomUUID() as never,
          expectedSessionRevision: 1,
          content: "越权",
        }),
      (x) => service.listIdeationTasks(x, { sessionId: s.id }),
      (x) => service.getIdeationTask(x, { taskId: accepted.turnId }),
      (x) =>
        service.cancelIdeationTask(x, {
          taskId: accepted.turnId,
          clientRequestId: randomUUID() as never,
        }),
      (x) => service.listIdeationEvents(x, { sessionId: s.id }),
    ];
    for (const operation of operations)
      for (const denied of [b, { ...a, userId: b.userId }])
        expect(await operation(denied)).toMatchObject({
          ok: false,
          error: { code: "NOT_FOUND" },
        });
    expect(
      await service.listIdeationSessions(
        { ...a, userId: b.userId },
        { status: "closed", after: "999999" as never },
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await service.createIdeationSession(
        { ...a, userId: b.userId },
        { clientRequestId: randomUUID() as never },
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await service.closeIdeationSession(a, {
        ...close,
        sessionId: "invalid" as never,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await service.closeIdeationSession(a, {
        ...close,
        sessionId: randomUUID() as never,
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      value(await service.getIdeationTask(a, { taskId: accepted.turnId }))
        .status,
    ).toBe("QUEUED");
  } finally {
    await p.service.stop();
    await q.service.stop();
  }
}, 30000);

it("event replay and pull-based SSE preserve durable order/reset barriers, header cursor precedence, and revoke access", async () => {
  const p = await fixture();
  try {
    const service = createIdeationService(p.service.db, { modelMode: "faux" }),
      actor = actorFor(p),
      s = await session(service, actor);
    const accepted = value(
      await service.sendIdeationMessage(actor, {
        sessionId: s.id,
        clientRequestId: randomUUID() as never,
        expectedSessionRevision: 0,
        content: "RAW_USER_SENTINEL",
      }),
    );
    await service.store.transaction(actor, async (tx) => {
      for (const data of [
        { type: "delta", role: "chuangyi-xietiaoyuan", text: "安全前缀" },
        {
          type: "reset",
          role: "chuangyi-xietiaoyuan",
          reason: "format_correction",
        },
        { type: "delta", role: "chuangyi-xietiaoyuan", text: "安全新尝试" },
      ] as const)
        await appendIdeationEvent(
          tx,
          actor,
          s.id,
          accepted.turnId,
          data as never,
        );
    });
    const events = value(
      await service.listIdeationEvents(actor, { sessionId: s.id }),
    ).items;
    expect(JSON.stringify(events)).not.toContain("RAW_USER_SENTINEL");
    expect(events.slice(-3).map((e) => e.type)).toEqual([
      "delta",
      "reset",
      "delta",
    ]);
    const response = value(
      await ideationSse(service, async () => actor, {
        sessionId: s.id,
        after: "0" as never,
        lastEventId: events[2]?.id ?? "0",
        pollMs: 1,
      }),
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain("event: reset");
    await p.service.db.pool.query(
      "UPDATE projects SET owner_id=$1 WHERE id=$2",
      [await newOwner(p), actor.projectId],
    );
    expect(await reader?.read()).toMatchObject({ done: true });
    expect(
      await ideationSse(service, async () => actor, { sessionId: s.id }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  } finally {
    await p.service.stop();
  }
}, 30000);
async function newOwner(p: Awaited<ReturnType<typeof fixture>>) {
  const id = randomUUID();
  await p.service.db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    id,
    `${id}@test.invalid`,
  ]);
  return id;
}

it.each([
  "INSUFFICIENT_CREDITS",
  "ACCOUNT_FROZEN",
  "BILLING_DISABLED",
] as const)("main billing integration enforces %s after ownership with no accepted turn or new charge", async (code) => {
  const p = await fixture();
  try {
    const actor = actorFor(p),
      service = createIdeationService(p.service.db, {
        modelMode: code === "BILLING_DISABLED" ? "real" : "faux",
      }),
      s = await session(service, actor);
    if (code === "INSUFFICIENT_CREDITS")
      await p.service.db.pool.query(
        "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'sandbox',-(SELECT coalesce(sum(delta_credits),0) FROM credit_ledger WHERE user_id=$1 AND bank='sandbox'),'test_fixture','user',$2)",
        [actor.userId, actor.userId],
      );
    if (code === "ACCOUNT_FROZEN")
      await p.service.db.pool.query(
        "UPDATE billing_accounts SET frozen_at=now() WHERE user_id=$1",
        [actor.userId],
      );
    if (code === "BILLING_DISABLED")
      await p.service.db.pool.query(
        "INSERT INTO subscriptions(user_id,provider,external_id,plan,status) VALUES($1,'mock',$2,'test-paid','active')",
        [actor.userId, randomUUID()],
      );
    const request = {
      sessionId: s.id,
      clientRequestId: randomUUID() as never,
      expectedSessionRevision: 0,
      content: "前置检查拒绝时不能受理",
    };
    expect(
      await service.sendIdeationMessage(
        { ...actor, userId: randomUUID() as never },
        request,
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    const before = await p.service.db.pool.query(
      "SELECT count(*)::text count FROM credit_ledger WHERE user_id=$1",
      [actor.userId],
    );
    expect(await service.sendIdeationMessage(actor, request)).toMatchObject({
      ok: false,
      error: { code },
    });
    expect(
      (
        await p.service.db.pool.query(
          "SELECT 1 FROM pipeline_runs WHERE project_id=$1",
          [actor.projectId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await p.service.db.pool.query(
          "SELECT 1 FROM credit_reservations WHERE user_id=$1",
          [actor.userId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await p.service.db.pool.query(
          "SELECT count(*)::text count FROM credit_ledger WHERE user_id=$1",
          [actor.userId],
        )
      ).rows,
    ).toEqual(before.rows);
  } finally {
    await p.service.stop();
  }
}, 30000);

it("serializes distinct sends and a concurrent close; accepted tasks survive closure and rejected sends leave no artifacts", async () => {
  const p = await fixture();
  try {
    const actor = actorFor(p);
    let unblock: () => void = () => {};
    let entered: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const service = createIdeationService(p.service.db, {
      modelMode: "faux",
      beforeRun: async () => {
        entered();
        await gate;
        return undefined;
      },
    });
    const s = await session(service, actor),
      request = {
        sessionId: s.id,
        clientRequestId: randomUUID() as never,
        expectedSessionRevision: 0,
        content: "第一条",
      };
    const send = service.sendIdeationMessage(actor, request);
    await ready;
    const close = service.closeIdeationSession(actor, {
      sessionId: s.id,
      clientRequestId: randomUUID() as never,
    });
    unblock();
    const accepted = value(await send);
    expect(value(await close).status).toBe("closed");
    expect(
      value(await service.getIdeationTask(actor, { taskId: accepted.turnId }))
        .status,
    ).toBe("QUEUED");
    expect(
      value(await service.listIdeationMessages(actor, { sessionId: s.id }))
        .items,
    ).toHaveLength(1);
    const other = await session(service, actor);
    const [a, b] = await Promise.all([
      service.sendIdeationMessage(actor, {
        ...request,
        sessionId: other.id,
        clientRequestId: randomUUID() as never,
      }),
      service.sendIdeationMessage(actor, {
        ...request,
        sessionId: other.id,
        clientRequestId: randomUUID() as never,
      }),
    ]);
    expect([a, b].filter((x) => x.ok)).toHaveLength(1);
    expect([a, b].find((x) => !x.ok)).toMatchObject({
      ok: false,
      error: { code: "TURN_IN_PROGRESS" },
    });
  } finally {
    await p.service.stop();
  }
}, 30000);

it("malformed/extra fields fail without writes; a failed acceptance transaction rolls back all artifacts", async () => {
  const p = await fixture();
  try {
    const actor = actorFor(p),
      service = createIdeationService(p.service.db, { modelMode: "faux" }),
      s = await session(service, actor);
    const req = {
      sessionId: s.id,
      clientRequestId: randomUUID() as never,
      expectedSessionRevision: 0,
      content: "正文",
    };
    expect(
      await service.sendIdeationMessage(actor, {
        ...req,
        role: "system",
      } as never),
    ).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    expect(
      await service.sendIdeationMessage(actor, {
        ...req,
        content: "字".repeat(8001),
      }),
    ).toMatchObject({ ok: false, error: { code: "INPUT_LIMIT_EXCEEDED" } });
    const broken = createIdeationService(p.service.db, {
      modelMode: "faux",
      beforeRun: async (tx) => {
        await tx.sql(
          "INSERT INTO pipeline_runs(id,project_id,kind,status,request) VALUES($1,$2,'test','QUEUED','{}')",
          [randomUUID(), actor.projectId],
        );
        throw new Error("private SQL/provider details");
      },
    });
    const error = await broken.sendIdeationMessage(actor, req);
    expect(error).toMatchObject({
      ok: false,
      error: { code: "INTERNAL_ERROR" },
    });
    expect(JSON.stringify(error)).not.toContain("private");
    expect(
      (
        await p.service.db.pool.query(
          "SELECT 1 FROM pipeline_runs WHERE project_id=$1",
          [actor.projectId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      value(await service.getIdeationSession(actor, { sessionId: s.id }))
        .revision,
    ).toBe(0);
  } finally {
    await p.service.stop();
  }
}, 30000);

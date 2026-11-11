import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createFauxRuntime,
  type Data,
  fauxOutput,
  type ModelRuntime,
} from "@ruwen/agents";
import type { IdeationActor, IdeationResult } from "@ruwen/pipeline";
import { afterEach, expect, inject, it } from "vitest";
import { defaultFauxResponse } from "../../../packages/agents/src/faux.ts";
import { forwardStream } from "../../../packages/agents/src/runtime/stream.ts";
import { deploymentCanary } from "../../../packages/agents/src/security/notes.ts";
import { createIdeationService } from "../src/ideation-service.ts";
import type { WorkerOptions } from "../src/service.ts";
import { fixture, waitStatus } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
it("uses main's explicit known-zero usage metadata when an ideation provider fails before generation", async () => {
  const runtime = createFauxRuntime();
  runtime.models.streamSimple = () => {
    throw new Error("Fixture unavailable before generation");
  };
  const p = await setup(() => runtime),
    accepted = value(await p.send("讨论角色在驿站的选择。"));
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: accepted.turnId,
  });
  const row = (
    await p.db.pool.query(
      "SELECT usage_unknown,cost_usd::text FROM role_runs WHERE run_id=$1",
      [accepted.turnId],
    )
  ).rows[0];
  expect(row).toEqual({ usage_unknown: false, cost_usd: "0.0000000000" });
  expect(
    (
      await p.db.pool.query(
        "SELECT status,remaining::text FROM credit_reservations WHERE run_id=$1",
        [accepted.turnId],
      )
    ).rows[0],
  ).toEqual({ status: "released", remaining: "0" });
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: accepted.turnId }))
      .error?.code,
  ).toBe("PROVIDER_UNAVAILABLE");
}, 30000);
it("reloads coordinator messages from DB on every tool turn, offers only its three tools, supports plain conversation and finishes an already accepted closed session", async () => {
  const requests: string[] = [];
  let p: Awaited<ReturnType<typeof setup>>;
  let call = 0;
  const runtime = createFauxRuntime(
    Array.from(
      { length: 10 },
      () => async (context: Parameters<typeof defaultFauxResponse>[0]) => {
        requests.push(JSON.stringify(context));
        call++;
        const tools = context.messages
          .flatMap((message) =>
            message.role === "system"
              ? (message.toolsAdded ?? []).map((tool) => tool.name)
              : [],
          )
          .sort();
        expect(tools).toEqual([
          "list_resources",
          "propose_handoff",
          "read_resource",
        ]);
        if (call === 1) {
          await p.db.pool.query(
            "INSERT INTO ideation_messages(project_id,session_id,role,content,session_revision) VALUES($1,$2,'assistant',$3,1)",
            [
              p.actor.projectId,
              p.session.id,
              JSON.stringify("DB_RELOAD_MARKER_仅数据库新增"),
            ],
          );
          return {
            ...defaultFauxResponse(context),
            content: [
              {
                type: "toolCall" as const,
                id: randomUUID(),
                name: "list_resources",
                arguments: {},
              },
            ],
            stopReason: "toolUse" as const,
          };
        }
        if (call === 2)
          return {
            ...defaultFauxResponse(context),
            content: [
              {
                type: "toolCall" as const,
                id: randomUUID(),
                name: "read_resource",
                arguments: { id: "xiangmu-zhangcheng" },
              },
            ],
            stopReason: "toolUse" as const,
          };
        return {
          ...defaultFauxResponse(context),
          content: [
            {
              type: "text" as const,
              text: "人物此刻仍有两个开放的选择，可以先讨论代价。",
            },
          ],
          stopReason: "stop" as const,
        };
      },
    ),
  );
  p = await setup(() => runtime);
  const first = value(await p.send("FIRST_USER_MESSAGE_协调员专用原话"));
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: first.turnId,
  });
  expect(requests).toHaveLength(3);
  expect(requests[0]).not.toContain("DB_RELOAD_MARKER");
  expect(requests[1]).toContain("DB_RELOAD_MARKER");
  expect(requests[2]).toContain("read_resource");
  expect(
    value(await p.service.listPreviews(p.actor, { sessionId: p.session.id }))
      .items,
  ).toHaveLength(0);
  const next = value(await p.send("SECOND_USER_MESSAGE_另一轮原话", 1));
  value(
    await p.service.closeIdeationSession(p.actor, {
      sessionId: p.session.id,
      clientRequestId: randomUUID() as never,
    }),
  );
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: next.turnId,
  });
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: next.turnId }))
      .status,
  ).toBe("SUCCEEDED");
  expect(requests[3]).toContain("FIRST_USER_MESSAGE");
  expect(requests[3]).toContain("SECOND_USER_MESSAGE");
  expect(
    value(
      await p.service.getIdeationSession(p.actor, { sessionId: p.session.id }),
    ).status,
  ).toBe("closed");
  expect(
    (
      await p.db.pool.query(
        "SELECT status,remaining::text FROM credit_reservations WHERE run_id=ANY($1::uuid[]) ORDER BY run_id",
        [[first.turnId, next.turnId]],
      )
    ).rows,
  ).toEqual([
    { status: "released", remaining: "0" },
    { status: "released", remaining: "0" },
  ]);
}, 30000);

it("preview IDs check foreign owner and wrong project, snapshots reject modification, and preview generation never writes canon", async () => {
  const p = await setup(),
    q = await setup();
  const before = await p.fs.sha256("世界/当前态势.md");
  const run = value(
    await p.send("SENTINEL_此段用户表达只能进入协调员会话甲乙丙丁戊己"),
  );
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: run.turnId,
  });
  const preview = value(
    await p.service.listPreviews(p.actor, { sessionId: p.session.id }),
  ).items[0];
  expect(preview).toBeDefined();
  if (!preview) throw new Error("preview");
  for (const actor of [q.actor, { ...p.actor, userId: q.actor.userId }]) {
    expect(
      await p.service.getPreview(actor, { previewId: preview.id }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(
      await p.service.listPreviews(actor, { sessionId: p.session.id }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  }
  await expect(
    p.db.pool.query("UPDATE ideation_previews SET snapshot='{}' WHERE id=$1", [
      preview.id,
    ]),
  ).rejects.toThrow();
  expect(await p.fs.sha256("世界/当前态势.md")).toBe(before);
  expect(await p.fs.list("治理/交接")).toEqual(["治理/交接/README.md"]);
}, 30000);
const value = <T>(result: IdeationResult<T>): T => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
async function setup(
  runtime: () => ModelRuntime = createFauxRuntime,
  consume = false,
  ideation: NonNullable<WorkerOptions["ideation"]> = {},
) {
  const p = await fixture({ runtime, ideation }, consume);
  cleanup.push(() => p.service.stop());
  const actor = {
    projectId: p.fs.projectId,
    userId: p.fs.ownerId,
  } as IdeationActor;
  const service = createIdeationService(p.service.db, {
    queue: p.service.queue,
    modelMode: "faux",
    ...ideation,
  });
  const session = value(
    await service.createIdeationSession(actor, {
      clientRequestId: randomUUID() as never,
    }),
  );
  const send = (content: string, revision = 0) =>
    service.sendIdeationMessage(actor, {
      sessionId: session.id,
      content,
      expectedSessionRevision: revision,
      clientRequestId: randomUUID() as never,
    });
  return {
    ...p,
    worker: p.service,
    db: p.service.db,
    actor,
    service,
    session,
    send,
  };
}
const clean = () =>
  fauxOutput("chuangyi-xietiaoyuan", {
    project_state: { project: "demo-ruwen" },
  }) as Data;

it("a guard revoked between tool turns stops the next model request and preserves its shared error code and prior usage", async () => {
  let guards = 0,
    calls = 0;
  const runtime = createFauxRuntime([
    (context) => {
      calls++;
      return {
        ...defaultFauxResponse(context),
        content: [
          {
            type: "toolCall",
            id: randomUUID(),
            name: "list_resources",
            arguments: {},
          },
        ],
        stopReason: "toolUse",
      };
    },
    (context) => {
      calls++;
      return defaultFauxResponse(context);
    },
  ]);
  const p = await setup(() => runtime, false, {
    beforeRun: async () => {
      guards++;
      return guards >= 4 ? "ACCOUNT_FROZEN" : undefined;
    },
  });
  const accepted = value(
    await p.send("仅协调员可读取这段用户原话哨兵甲乙丙丁戊己庚辛"),
  );
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: accepted.turnId,
  });
  expect(calls).toBe(1);
  expect(guards).toBe(4);
  expect(
    value(
      await p.service.getIdeationTask(p.actor, { taskId: accepted.turnId }),
    ),
  ).toMatchObject({ status: "FAILED", error: { code: "ACCOUNT_FROZEN" } });
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM role_cost_events e JOIN role_runs r ON r.id=e.role_run_id WHERE r.run_id=$1",
        [accepted.turnId],
      )
    ).rowCount,
  ).toBe(1);
}, 30000);

it("reservation binding shares the acceptance transaction; coordinator recording fails closed before any wording snapshot", async () => {
  const p = await setup();
  const service = createIdeationService(p.db, {
    modelMode: "faux",
    onRunAccepted: async (tx, actor, runId) => {
      expect(
        (
          await tx.sql(
            "SELECT 1 FROM credit_reservations WHERE user_id=$1 AND run_id=$2 AND status='active'",
            [actor.userId, runId],
          )
        ).rowCount,
      ).toBe(1);
      return "INSUFFICIENT_CREDITS";
    },
  });
  const req = {
    sessionId: p.session.id,
    clientRequestId: randomUUID() as never,
    expectedSessionRevision: 0,
    content: "不能保留事务内的失败受理",
  };
  expect(await service.sendIdeationMessage(p.actor, req)).toMatchObject({
    ok: false,
    error: { code: "INSUFFICIENT_CREDITS" },
  });
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM credit_reservations WHERE user_id=$1",
        [p.actor.userId],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await p.db.pool.query("SELECT 1 FROM pipeline_runs WHERE project_id=$1", [
        p.actor.projectId,
      ])
    ).rowCount,
  ).toBe(0);
  const recording = createIdeationService(p.db, {
    modelMode: "record",
    beforeRun: async () => undefined,
  });
  expect(await recording.sendIdeationMessage(p.actor, req)).toMatchObject({
    ok: false,
    error: { code: "PRECONDITION_FAILED" },
  });
  expect(
    value(
      await service.listIdeationMessages(p.actor, { sessionId: p.session.id }),
    ).items,
  ).toHaveLength(0);
}, 30000);
function responseRuntime(output: () => Data, onCall: () => void = () => {}) {
  return createFauxRuntime(
    Array.from(
      { length: 30 },
      () => (context: Parameters<typeof defaultFauxResponse>[0]) => {
        onCall();
        return {
          ...defaultFauxResponse(context),
          content: [
            {
              type: "toolCall" as const,
              id: randomUUID(),
              name: "propose_handoff",
              arguments: output(),
            },
          ],
          stopReason: "toolUse" as const,
        };
      },
    ),
  );
}

it("real pg-boss consumes the durable outbox, saves a clean communication preview and checkpoint, and never writes user wording to other storage", async () => {
  let calls = 0;
  const p = await setup(
    () =>
      responseRuntime(clean, () => {
        calls++;
      }),
    true,
  );
  const raw = "RAW_COORDINATOR_SENTINEL_只留在会话消息_一二三四五六七八九十";
  const accepted = value(await p.send(raw));
  await waitStatus(p.worker, accepted.turnId, "SUCCEEDED");
  expect(
    value(await p.service.getIdeationTask(p.actor, { taskId: accepted.turnId }))
      .status,
  ).toBe("SUCCEEDED");
  const previews = value(
    await p.service.listPreviews(p.actor, { sessionId: p.session.id }),
  ).items;
  expect(previews).toHaveLength(1);
  expect(previews[0]?.kind).toBe("handoff");
  const serialized = JSON.stringify({
    previews,
    events: value(
      await p.service.listIdeationEvents(p.actor, { sessionId: p.session.id }),
    ).items,
    task: value(
      await p.service.getIdeationTask(p.actor, { taskId: accepted.turnId }),
    ),
  });
  expect(serialized).not.toContain(raw);
  const rows = await p.db.pool.query(
    "SELECT result,transcript FROM role_runs WHERE run_id=$1",
    [accepted.turnId],
  );
  expect(JSON.stringify(rows.rows)).not.toContain(raw);
  expect(rows.rows[0]?.transcript).toEqual([]);
  expect(
    (
      await p.db.pool.query("SELECT 1 FROM ideation_outbox WHERE run_id=$1", [
        accepted.turnId,
      ])
    ).rowCount,
  ).toBe(0);
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: accepted.turnId,
  });
  expect(calls).toBe(1);
  expect(
    value(
      await p.service.listIdeationMessages(p.actor, {
        sessionId: p.session.id,
      }),
    ).items[0]?.content,
  ).toBe(raw);
}, 30000);

it("creation-check rejects copied original wording before any immutable preview exists, retaining actual usage once", async () => {
  const raw =
    "本段独特的用户表达不得被复制成任何下游岗位的创意委托长片段甲乙丙丁";
  const p = await setup(() =>
    responseRuntime(() => {
      const output = clean();
      (output.payload as Data).creative_value = raw;
      return output;
    }),
  );
  const accepted = value(await p.send(raw));
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: accepted.turnId,
  });
  expect(
    value(
      await p.service.getIdeationTask(p.actor, { taskId: accepted.turnId }),
    ),
  ).toMatchObject({
    status: "FAILED",
    error: { code: "CREATION_CHECK_FAILED" },
  });
  expect(
    value(await p.service.listPreviews(p.actor, { sessionId: p.session.id }))
      .items,
  ).toHaveLength(0);
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM role_cost_events e JOIN role_runs r ON r.id=e.role_run_id WHERE r.run_id=$1",
        [accepted.turnId],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    JSON.stringify(
      (
        await p.db.pool.query(
          "SELECT result,transcript FROM role_runs WHERE run_id=$1",
          [accepted.turnId],
        )
      ).rows,
    ),
  ).not.toContain(raw);
}, 30000);

it("own-session raw quotes stream without refusal; existing private-content boundaries remain intact", async () => {
  const raw = "RAW_PRIVATE_WORDING_不能跨增量拼接后流入事件_甲乙丙丁戊己庚辛";
  const thought = "THINKING_SENTINEL_只有模型私有内存";
  const runtime = createFauxRuntime([
    (context) => ({
      ...defaultFauxResponse(context),
      content: [
        {
          type: "thinking",
          thinking: thought + deploymentCanary(),
          thinkingSignature: "PRIVATE_SIGNATURE",
        },
        { type: "text", text: `先聊人物的代价。${raw}` },
      ],
      stopReason: "stop",
    }),
  ]);
  const stream = runtime.models.streamSimple.bind(runtime.models);
  runtime.models.streamSimple = (model, context, options) =>
    forwardStream(stream(model, context, options), { characterDelayMs: 0 });
  const p = await setup(() => runtime);
  const accepted = value(await p.send(raw));
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: accepted.turnId,
  });
  const events = value(
    await p.service.listIdeationEvents(p.actor, { sessionId: p.session.id }),
  ).items;
  expect(events.some((e) => e.type === "delta")).toBe(true);
  expect(
    events.some((e) => e.type === "reset" && e.reason === "security_refusal"),
  ).toBe(false);
  expect(
    events
      .filter((e) => e.type === "delta")
      .map((e) => e.text)
      .join(""),
  ).toContain(raw);
  const messages = value(
    await p.service.listIdeationMessages(p.actor, { sessionId: p.session.id }),
  ).items;
  expect(messages.at(-1)?.content).toContain(raw);
  const cache = (
    await p.db.pool.query(
      "SELECT result,transcript FROM role_runs WHERE run_id=$1",
      [accepted.turnId],
    )
  ).rows;
  expect(JSON.stringify(cache)).not.toContain(raw);
  const all = JSON.stringify({ messages, events, cache });
  expect(all).not.toContain(thought);
  expect(all).not.toContain(deploymentCanary());
  expect(all).not.toContain("PRIVATE_SIGNATURE");
}, 30000);

it("coordinator canary refusal preserves delta/reset/refusal order and public storage never contains the marker", async () => {
  const runtime = createFauxRuntime([
    (context) => ({
      ...defaultFauxResponse(context),
      content: [
        {
          type: "text",
          text:
            "人物将手搭在门边，停下来听院子里的声音。".repeat(3) +
            deploymentCanary(),
        },
      ],
      stopReason: "stop",
    }),
  ]);
  const p = await setup(() => runtime);
  const accepted = value(await p.send("请继续讨论这个项目里的角色。"));
  await p.worker.handle({
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: accepted.turnId,
  });
  const events = value(
    await p.service.listIdeationEvents(p.actor, { sessionId: p.session.id }),
  ).items;
  const frames = events.filter((e) => e.type === "delta" || e.type === "reset");
  const resetAt = frames.findIndex((e) => e.type === "reset");
  expect(resetAt).toBeGreaterThan(0);
  expect(frames.slice(0, resetAt).every((e) => e.type === "delta")).toBe(true);
  expect(frames.slice(resetAt + 1).every((e) => e.type === "delta")).toBe(true);
  expect(
    frames
      .slice(resetAt + 1)
      .map((e) => (e.type === "delta" ? e.text : ""))
      .join(""),
  ).toBe("这部分属于平台内部设置，我没法提供。我们继续聊你的故事吧。");
  expect(JSON.stringify(events)).not.toContain(deploymentCanary());
  expect(
    value(
      await p.service.listIdeationMessages(p.actor, {
        sessionId: p.session.id,
      }),
    ).items.at(-1)?.content,
  ).toContain("这部分属于平台内部设置");
}, 30000);

it.each([
  "role_response",
  "role_completed",
])("native SIGKILL at %s recovers without another model call or duplicate costs/preview", async (boundary) => {
  let requests = 0;
  const p = await setup(() =>
    createFauxRuntime([
      (context) => {
        requests++;
        return defaultFauxResponse(context);
      },
    ]),
  );
  const accepted = value(
    await p.send(
      "RECOVERY_SENTINEL_原始表达不能进入岗位缓存或项目报告甲乙丙丁",
    ),
  );
  const task = {
    kind: "ideation",
    projectId: p.actor.projectId,
    ownerId: p.actor.userId,
    runId: accepted.turnId,
  };
  const proc = spawn(
    process.execPath,
    [fileURLToPath(new URL("./ideation-child.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        RUWEN_CHILD_DB: inject("databaseUrl"),
        RUWEN_CHILD_QUEUE: p.worker.queue,
        RUWEN_CHILD_TASK: JSON.stringify(task),
        RUWEN_IDEATION_FAULT: boundary,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let exited = false;
  let stderr = "";
  proc.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const closed = new Promise<void>((resolve) =>
    proc.on("exit", () => {
      exited = true;
      resolve();
    }),
  );
  cleanup.push(async () => {
    if (!exited) proc.kill("SIGKILL");
    await closed;
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Child did not reach checkpoint: ${stderr}`)),
      15000,
    );
    proc.on("message", (message) => {
      if ((message as { type: string }).type === "fault") {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.on("exit", () => {
      clearTimeout(timeout);
      reject(new Error(`Child exited early: ${stderr}`));
    });
  });
  proc.kill("SIGKILL");
  await closed;
  // OS exit and PostgreSQL releasing its dead backend session are separate boundaries.
  const deadline = Date.now() + 5000;
  while (true) {
    const c = await p.db.pool.connect();
    try {
      const acquired = (
        await c.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
          [`ruwen:project:${p.actor.projectId}`],
        )
      ).rows[0]?.locked;
      if (acquired) {
        await c.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          `ruwen:project:${p.actor.projectId}`,
        ]);
        break;
      }
    } finally {
      c.release();
    }
    if (Date.now() > deadline)
      throw new Error("Dead worker lock was not released");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await p.worker.handle(task as never);
  const saved = value(
    await p.service.getIdeationTask(p.actor, { taskId: accepted.turnId }),
  );
  expect(saved.status).toBe(
    boundary === "role_response" ? "INTERRUPTED" : "SUCCEEDED",
  );
  expect(saved.usage.costUsd === null).toBe(boundary === "role_response");
  expect(
    (
      await p.db.pool.query("SELECT 1 FROM role_runs WHERE run_id=$1", [
        accepted.turnId,
      ])
    ).rowCount,
  ).toBe(1);
  expect(
    value(await p.service.listPreviews(p.actor, { sessionId: p.session.id }))
      .items,
  ).toHaveLength(boundary === "role_response" ? 0 : 1);
  expect(requests).toBe(0);
  const held = (
    await p.db.pool.query(
      "SELECT status,remaining::text FROM credit_reservations WHERE run_id=$1",
      [accepted.turnId],
    )
  ).rows[0];
  expect(held?.status).toBe(
    boundary === "role_response" ? "review" : "released",
  );
  expect(held?.remaining === "0").toBe(boundary === "role_completed");
  expect(
    (
      await p.db.pool.query(
        "SELECT 1 FROM credit_ledger l JOIN role_runs r ON r.id::text=l.ref_id WHERE r.run_id=$1 AND l.reason='role_usage'",
        [accepted.turnId],
      )
    ).rowCount,
  ).toBe(boundary === "role_completed" ? 1 : 0);
}, 30000);

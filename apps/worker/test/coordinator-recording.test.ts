import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  COORDINATOR_RECORDING_FORMAT,
  createApplicationRuntime,
  createFauxRuntime,
  type ModelRuntime,
} from "@ruwen/agents";
import type { IdeationActor, IdeationResult } from "@ruwen/pipeline";
import { afterEach, expect, it } from "vitest";
import { defaultFauxResponse } from "../../../packages/agents/src/faux.ts";
import { createIdeationService } from "../src/ideation-service.ts";
import { fixture } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
function value<T>(r: IdeationResult<T>): T {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), "ruwen-worker-tapes-"));
  cleanup.push(async () => {
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("ruwen-worker-tapes-")
    )
      throw new Error("unsafe cleanup");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function setup(runtime: ModelRuntime, content: string) {
  const p = await fixture({
    runtime: () => runtime,
    ideation: { coordinatorRecordingFormat: COORDINATOR_RECORDING_FORMAT },
  });
  cleanup.push(() => p.service.stop());
  const actor = {
    projectId: p.fs.projectId,
    userId: p.fs.ownerId,
  } as IdeationActor;
  // Transport recording wraps ONLY a faux model here. Its producer keeps sandbox reservations;
  // production record admission still uses the main thread's unchanged live billing guards.
  const producer = createIdeationService(p.service.db, {
    queue: p.service.queue,
    modelMode: "faux",
  });
  const session = value(
    await producer.createIdeationSession(actor, {
      clientRequestId: randomUUID() as never,
    }),
  );
  const accepted = value(
    await producer.sendIdeationMessage(actor, {
      sessionId: session.id,
      expectedSessionRevision: 0,
      content,
      clientRequestId: randomUUID() as never,
    }),
  );
  const handle = () =>
    p.service.handle({
      kind: "ideation",
      projectId: actor.projectId,
      ownerId: actor.userId,
      runId: accepted.turnId,
    });
  const messages = () =>
    producer.listIdeationMessages(actor, { sessionId: session.id });
  return { ...p, actor, producer, session, accepted, handle, messages };
}

it("worker binds actual DB-loaded coordinator wording for multi-turn recording and offline replay", async () => {
  const root = await folder(),
    raw = "DB_SOURCE_RECORD_SENTINEL_协调员的用户原话😀甲乙丙丁戊己庚辛";
  const upstream = createFauxRuntime([
    (context) => ({
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
    }),
    (context) => ({
      ...defaultFauxResponse(context),
      content: [{ type: "text", text: `你说过：${raw}。我先保留这些问题。` }],
      stopReason: "stop",
    }),
  ]);
  const recording = createApplicationRuntime({
    mode: "record",
    workspaceRoot: root,
    upstream,
  });
  const p = await setup(recording, raw);
  await p.handle();
  const recordedTask = value(
    await p.producer.getIdeationTask(p.actor, { taskId: p.accepted.turnId }),
  );
  expect(
    recordedTask.status,
    JSON.stringify({
      task: recordedTask.error,
    }),
  ).toBe("SUCCEEDED");
  const first = value(await p.messages()).items.at(-1)?.content;
  expect(first).toContain(raw);
  const directory = path.join(root, ".local/model-recordings"),
    files = await readdir(directory);
  expect(files).toHaveLength(2);
  for (const file of files) {
    const text = await readFile(path.join(directory, file), "utf8");
    expect(text).not.toContain(raw);
    expect(text).not.toContain(raw.slice(0, 20));
    expect(JSON.parse(text).version).toBe(4);
    expect(JSON.parse(text).request).toBeUndefined();
  }
  let live = 0;
  const offline = createFauxRuntime([]);
  offline.models.streamSimple = (() => {
    live++;
    throw new Error("offline replay cannot call upstream");
  }) as typeof offline.models.streamSimple;
  const replaying = createApplicationRuntime({
    mode: "replay",
    workspaceRoot: root,
    upstream: offline,
  });
  const q = await setup(replaying, raw);
  await q.handle();
  const replayedTask = value(
    await q.producer.getIdeationTask(q.actor, { taskId: q.accepted.turnId }),
  );
  expect(replayedTask.status, JSON.stringify(replayedTask.error)).toBe(
    "SUCCEEDED",
  );
  expect(value(await q.messages()).items.at(-1)?.content).toBe(first);
  expect(live).toBe(0);
  expect(await readdir(directory)).toEqual(files);
  const usage = async (p: Awaited<ReturnType<typeof setup>>) =>
    (
      await p.service.db.pool.query(
        "SELECT usage,cost_usd::text FROM role_runs WHERE run_id=$1",
        [p.accepted.turnId],
      )
    ).rows[0];
  expect(await usage(q)).toEqual(await usage(p));
}, 30000);

it("concurrent projects sharing a recorder keep their source readers isolated", async () => {
  const root = await folder(),
    a = "COORD_A_PRIVATE_仅甲会话原话_一二三四五六七八九十",
    b = "COORD_B_PRIVATE_仅乙会话原话_子丑寅卯辰巳午未申酉";
  const runtime = createApplicationRuntime({
    mode: "record",
    workspaceRoot: root,
    upstream: createFauxRuntime(
      Array.from({ length: 4 }, () => (context) => ({
        ...defaultFauxResponse(context),
        content: [
          {
            type: "text",
            text: JSON.stringify(context.messages).includes("COORD_A_PRIVATE")
              ? `只答甲：${a}`
              : `只答乙：${b}`,
          },
        ],
        stopReason: "stop",
      })),
    ),
  });
  const p = await setup(runtime, a),
    q = await setup(runtime, b);
  await Promise.all([p.handle(), q.handle()]);
  const first = value(await p.messages()).items.at(-1)?.content,
    second = value(await q.messages()).items.at(-1)?.content;
  expect(first).toContain(a);
  expect(first).not.toContain(b);
  expect(second).toContain(b);
  expect(second).not.toContain(a);
  const directory = path.join(root, ".local/model-recordings"),
    files = await readdir(directory);
  expect(files).toHaveLength(2);
  for (const file of files) {
    const text = await readFile(path.join(directory, file), "utf8");
    expect(text).not.toContain(a);
    expect(text).not.toContain(b);
  }
}, 30000);

it.each([
  "record",
  "replay",
] as const)("worker refuses an unsafe %s runtime before provider or role intent", async (mode) => {
  const fake = createFauxRuntime();
  let calls = 0;
  fake.models.streamSimple = (() => {
    calls++;
    throw new Error("provider must not run");
  }) as typeof fake.models.streamSimple;
  const p = await setup(
    { ...fake, mode },
    "仅保存在数据库的安全绑定测试原话甲乙丙丁戊己庚辛",
  );
  await p.handle();
  const task = value(
    await p.producer.getIdeationTask(p.actor, { taskId: p.accepted.turnId }),
  );
  expect(task.error?.code).toBe("PRECONDITION_FAILED");
  expect(calls).toBe(0);
  expect(
    (
      await p.service.db.pool.query("SELECT 1 FROM role_runs WHERE run_id=$1", [
        p.accepted.turnId,
      ])
    ).rowCount,
  ).toBe(0);
}, 30000);

import { randomUUID } from "node:crypto";
import type { Data } from "@ruwen/agents";
import { fauxOutput } from "@ruwen/agents";
import type {
  IdeationActor,
  IdeationCursor,
  IdeationResult,
} from "@ruwen/pipeline";
import { afterEach, expect, it } from "vitest";
import {
  createIdeationService,
  createIdeationServiceV1_2,
} from "../src/ideation-service.ts";
import { fixture } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of cleanup.splice(0)) await stop();
});
function next(cursor: IdeationCursor | null) {
  if (!cursor) throw new Error("Expected next cursor");
  return cursor;
}
function value<T>(r: IdeationResult<T>): T {
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

it("pages sessions/messages/tasks and both preview APIs numerically across decimal widths above JS safe integers", async () => {
  const p = await fixture();
  cleanup.push(() => p.service.stop());
  const actor = {
    projectId: p.fs.projectId,
    userId: p.fs.ownerId,
  } as IdeationActor;
  const options = { queue: p.service.queue, modelMode: "faux" as const },
    service = createIdeationService(p.service.db, options),
    v12 = createIdeationServiceV1_2(p.service.db, options);
  const session = value(
    await service.createIdeationSession(actor, {
      clientRequestId: randomUUID() as never,
    }),
  );
  const older = "9900000000000000",
    newer = "10000000000000000",
    sessions: string[] = [],
    messages: string[] = [],
    tasks: string[] = [];
  for (const [index, offset] of [older, newer].entries()) {
    const sid = randomUUID(),
      mid = randomUUID(),
      run = randomUUID();
    sessions.push(sid);
    messages.push(mid);
    tasks.push(run);
    // Never reset shared identity sequences. Fixture rows use unique high ranges on either
    // side of a decimal-width boundary; ordinary generated rows remain below both ranges.
    await p.service.db.pool.query(
      "INSERT INTO ideation_sessions(id,project_id,ordinal) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3::bigint+nextval(pg_get_serial_sequence('ideation_sessions','ordinal')))",
      [sid, actor.projectId, offset],
    );
    await p.service.db.pool.query(
      "INSERT INTO ideation_messages(id,project_id,session_id,role,content,session_revision,ordinal) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,$4,$5,0,$6::bigint+nextval(pg_get_serial_sequence('ideation_messages','ordinal')))",
      [
        mid,
        actor.projectId,
        session.id,
        index ? "assistant" : "user",
        JSON.stringify(index ? "NEWER" : "OLDER"),
        offset,
      ],
    );
    await p.service.db.pool.query(
      "INSERT INTO pipeline_runs(id,project_id,kind,status,request) VALUES($1,$2,'ideation_coordinator','SUCCEEDED','{}')",
      [run, actor.projectId],
    );
    await p.service.db.pool.query(
      "INSERT INTO ideation_tasks(run_id,project_id,session_id,role,stage,session_revision,ordinal) OVERRIDING SYSTEM VALUE VALUES($1,$2,$3,'chuangyi-xietiaoyuan','coordinator',0,$4::bigint+nextval(pg_get_serial_sequence('ideation_tasks','ordinal')))",
      [run, actor.projectId, session.id, offset],
    );
  }
  const listed = value(await service.listIdeationSessions(actor, {}));
  expect(listed.items.map((s) => s.id)).toEqual([session.id, ...sessions]);
  const s1 = value(await service.listIdeationSessions(actor, { limit: 2 }));
  expect(s1.nextCursor).not.toBeNull();
  expect(
    value(
      await service.listIdeationSessions(actor, {
        after: next(s1.nextCursor),
        limit: 2,
      }),
    ).items.map((s) => s.id),
  ).toEqual([sessions[1]]);
  const m1 = value(
    await service.listIdeationMessages(actor, {
      sessionId: session.id,
      limit: 1,
    }),
  );
  expect(m1.items[0]?.id).toBe(messages[0]);
  expect(
    value(
      await service.listIdeationMessages(actor, {
        sessionId: session.id,
        limit: 1,
        after: next(m1.nextCursor),
      }),
    ).items[0]?.id,
  ).toBe(messages[1]);
  const t1 = value(
    await service.listIdeationTasks(actor, { sessionId: session.id, limit: 1 }),
  );
  expect(t1.items[0]?.id).toBe(tasks[0]);
  expect(
    value(
      await service.listIdeationTasks(actor, {
        sessionId: session.id,
        limit: 1,
        after: next(t1.nextCursor),
      }),
    ).items[0]?.id,
  ).toBe(tasks[1]);
  const prototype = await service.store.transaction(actor, async (tx) =>
    service.saveHandoff(
      tx,
      actor,
      await service.ownedTask(tx, actor, tasks[0] ?? ""),
      fauxOutput("chuangyi-xietiaoyuan", {
        project_state: { project: "demo-ruwen" },
      }) as Data,
    ),
  );
  const previews: string[] = [];
  const original = (
    await p.service.db.pool.query<{ snapshot: string }>(
      "SELECT snapshot FROM ideation_previews WHERE id=$1",
      [prototype.id],
    )
  ).rows[0];
  if (!original) throw new Error("Missing prototype");
  for (const offset of [older, newer]) {
    const id = randomUUID();
    const snapshot = JSON.parse(original.snapshot);
    snapshot.id = id;
    const bytes = JSON.stringify(snapshot);
    previews.push(id);
    await p.service.db.pool.query(
      `INSERT INTO ideation_previews(id,project_id,session_id,task_id,kind,snapshot,sha256,ordinal) OVERRIDING SYSTEM VALUE
  SELECT $2::uuid,project_id,session_id,task_id,kind,$4,encode(sha256(convert_to($4,'UTF8')),'hex'),$3::bigint+nextval(pg_get_serial_sequence('ideation_previews','ordinal')) FROM ideation_previews WHERE id=$1`,
      [prototype.id, id, offset, bytes],
    );
  }
  for (const api of [service, v12]) {
    const first = value(
      await api.listPreviews(actor, { sessionId: session.id, limit: 2 }),
    );
    expect(first.items.map((p) => p.id)).toEqual([prototype.id, previews[0]]);
    expect(
      value(
        await api.listPreviews(actor, {
          sessionId: session.id,
          limit: 2,
          after: next(first.nextCursor),
        }),
      ).items.map((p) => p.id),
    ).toEqual([previews[1]]);
  }
}, 30000);

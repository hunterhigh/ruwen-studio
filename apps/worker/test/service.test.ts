import { randomUUID } from "node:crypto";
import {
  createFauxRuntime,
  DEFAULT_ROLE_TIMEOUT_MS,
  ROLE_OUTPUT_ATTEMPTS,
} from "@ruwen/agents";
import { PostgresFS } from "@ruwen/db";
import { CHAPTER_ROLES, loadRun } from "@ruwen/pipeline";
import { afterEach, expect, it } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import { queueExpirySeconds } from "../src/service.ts";
import { fixture, waitStatus } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];
it("queue expiry derives from actual role timeout, chapter role count, output attempts and margin, including existing queues", async () => {
  const p = await fixture({ roleTimeoutMs: 1501, queueMarginSeconds: 123 });
  cleanups.push(() => p.service.stop());
  const roles = Object.keys(CHAPTER_ROLES).length;
  const expected =
    Math.ceil((1501 * roles * ROLE_OUTPUT_ATTEMPTS) / 1000) + 123;
  expect(queueExpirySeconds(1501, roles, ROLE_OUTPUT_ATTEMPTS, 123)).toBe(
    expected,
  );
  expect(
    (await p.service.boss.getQueue(p.service.queue))?.expireInSeconds,
  ).toBe(expected);
  expect(
    queueExpirySeconds(
      DEFAULT_ROLE_TIMEOUT_MS,
      roles,
      ROLE_OUTPUT_ATTEMPTS,
      120,
    ),
  ).toBe(7320);
  await p.service.boss.updateQueue(p.service.queue, { expireInSeconds: 3600 });
  await p.service.stop();
  cleanups.pop();
  const replacement = await fixture({
    queue: p.service.queue,
    roleTimeoutMs: 1501,
    queueMarginSeconds: 123,
  });
  cleanups.push(() => replacement.service.stop());
  expect(
    (await replacement.service.boss.getQueue(replacement.service.queue))
      ?.expireInSeconds,
  ).toBe(expected);
});
it("one process runs distinct projects concurrently; a busy project defers without blocked pool connections or duplicate costs", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = false;
  const p = await fixture(
    {
      concurrency: 3,
      runtime: () =>
        createFauxRuntime(
          Array.from({ length: 100 }, () => async (context) => {
            if (!held && requestRole(context) === "xiaoshuo-zuozhe") {
              held = true;
              await gate;
            }
            return defaultFauxResponse(context);
          }),
        ),
    },
    true,
  );
  cleanups.push(() => p.service.stop());
  const other = await fixture();
  cleanups.push(() => other.service.stop());
  const first = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  try {
    await expect.poll(() => held, { timeout: 5000 }).toBe(true);
    const busy = await p.service.enqueueChapter(p.fs, { chapter: 1 });
    const parallel = await p.service.enqueueChapter(other.fs, { chapter: 1 });
    await waitStatus(p.service, parallel, "AWAITING_CANDIDATE_APPROVAL");
    expect(
      (
        await p.service.db.pool.query(
          "SELECT id FROM role_runs WHERE run_id=$1",
          [busy],
        )
      ).rowCount,
    ).toBe(0);
    const deferred = await p.service.db.pool.query<{ n: string }>(
      "SELECT count(*) n FROM pgboss.job WHERE name=$1 AND data->>'runId'=$2 AND (data->>'lockDeferrals')::int >= 1",
      [p.service.queue, busy],
    );
    expect(Number(deferred.rows[0]?.n)).toBeGreaterThan(0);
    expect(
      (
        await p.service.db.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE wait_event='advisory' AND query LIKE '%pg_advisory_lock%'",
        )
      ).rowCount,
    ).toBe(0);
    release();
    await waitStatus(p.service, first, "AWAITING_CANDIDATE_APPROVAL");
    await waitStatus(p.service, busy, "AWAITING_CANDIDATE_APPROVAL");
    for (const id of [first, busy, parallel]) {
      expect(
        (
          await p.service.db.pool.query(
            "SELECT role_run_id FROM role_cost_events WHERE role_run_id IN (SELECT id FROM role_runs WHERE run_id=$1)",
            [id],
          )
        ).rowCount,
      ).toBe(5);
    }
  } finally {
    release();
  }
}, 30000);
it("length failure persists incurred usage once and never promotes truncated prose", async () => {
  const runtime = createFauxRuntime([
    (context) => ({ ...defaultFauxResponse(context), stopReason: "length" }),
  ]);
  const p = await fixture({ runtime: () => runtime }, true);
  cleanups.push(() => p.service.stop());
  const id = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  await waitStatus(p.service, id, "FAILED");
  const row = await p.service.db.pool.query<{
    usage: { output: number }[];
    status: string;
    cost_usd: string;
  }>("SELECT usage,status,cost_usd FROM role_runs WHERE run_id=$1", [id]);
  expect(row.rowCount).toBe(1);
  expect(row.rows[0]?.status).toBe("failed");
  expect(row.rows[0]?.usage[0]?.output).toBeGreaterThan(0);
  expect(row.rows[0]?.cost_usd).not.toBeNull();
  expect(runtime.faux.state.callCount).toBe(1);
  expect(
    (
      await p.service.db.pool.query(
        "SELECT role_run_id FROM role_cost_events WHERE role_run_id IN (SELECT id FROM role_runs WHERE run_id=$1)",
        [id],
      )
    ).rowCount,
  ).toBe(1);
  expect(await p.fs.exists("chapters/chapter-001.md")).toBe(false);
}, 30000);
it("role_runs persists the provider cacheRead/cacheWrite counters and additive migrations are idempotent", async () => {
  const p = await fixture({}, true);
  cleanups.push(() => p.service.stop());
  const id = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  await waitStatus(p.service, id, "AWAITING_CANDIDATE_APPROVAL");
  const rows = await p.service.db.pool.query<{
    cache_read_tokens: string;
    cache_write_tokens: string;
    usage: { cacheRead: number; cacheWrite: number }[];
  }>(
    "SELECT cache_read_tokens,cache_write_tokens,usage FROM role_runs WHERE run_id=$1",
    [id],
  );
  expect(rows.rowCount).toBe(5);
  expect(
    rows.rows.every(
      (row) =>
        Number(row.cache_read_tokens) ===
          row.usage.reduce((sum, usage) => sum + usage.cacheRead, 0) &&
        Number(row.cache_write_tokens) ===
          row.usage.reduce((sum, usage) => sum + usage.cacheWrite, 0),
    ),
  ).toBe(true);
  expect(rows.rows.some((row) => Number(row.cache_write_tokens) > 0)).toBe(
    true,
  );
  await p.service.db.migrate();
  expect(
    (await p.service.db.pool.query("SELECT id FROM ruwen_migrations")).rowCount,
  ).toBe(2);
}, 30000);
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
it("actual pg-boss worker runs to both approval gates, commits once and emits transactional progress", async () => {
  const { service, fs } = await fixture({}, true);
  cleanups.push(() => service.stop());
  const listener = await service.db.pool.connect();
  const notices: string[] = [];
  listener.on("notification", (message) => {
    if (message.payload) notices.push(message.payload);
  });
  await listener.query("LISTEN ruwen_runs");
  try {
    const id = await service.enqueueChapter(fs, { chapter: 1 });
    await waitStatus(service, id, "AWAITING_CANDIDATE_APPROVAL");
    let run = await loadRun(fs, id);
    expect(await fs.exists(run.target)).toBe(false);
    await service.enqueueApproval(fs, id, "candidate", {
      confirmed: true,
      expectedSha256: String(run.candidateSha256),
    });
    await waitStatus(service, id, "AWAITING_MEMORY_APPROVAL");
    run = await loadRun(fs, id);
    await service.enqueueApproval(fs, id, "memory", {
      confirmed: true,
      expectedSha256: String(run.memoryPreviewSha256),
    });
    await waitStatus(service, id, "DONE");
    run = await loadRun(fs, id);
    expect(await fs.exists(run.target)).toBe(true);
    const counts = () =>
      service.db.pool.query<{ n: string }>(
        "SELECT count(*) n FROM role_cost_events c JOIN role_runs r ON r.id=c.role_run_id WHERE r.run_id=$1",
        [id],
      );
    expect((await counts()).rows[0]?.n).toBe("6");
    await service.handle({
      kind: "chapter",
      projectId: fs.projectId,
      ownerId: fs.ownerId,
      runId: id,
    });
    await service.handle({
      kind: "memory",
      projectId: fs.projectId,
      ownerId: fs.ownerId,
      runId: id,
      decision: {
        confirmed: true,
        expectedSha256: String(run.memoryPreviewSha256),
      },
    });
    expect((await counts()).rows[0]?.n).toBe("6");
    const consumed = await service.db.pool.query(
      "SELECT id FROM approval_events WHERE project_id=$1 AND id=ANY($2::text[]) AND consumed_at IS NOT NULL",
      [fs.projectId, [`candidate-${id}`, `memory-${id}`]],
    );
    expect(consumed.rowCount).toBe(2);
    expect(
      notices.some(
        (n) => JSON.parse(n).runId === id && JSON.parse(n).status === "DONE",
      ),
    ).toBe(true);
  } finally {
    await listener.query("UNLISTEN *");
    listener.release();
  }
}, 30000);
it("queue producers reject a foreign owner and an unconfirmed or stale approval", async () => {
  const { service, fs } = await fixture({}, true);
  cleanups.push(() => service.stop());
  await expect(
    service.enqueueChapter(
      new PostgresFS(service.db, fs.projectId, randomUUID()),
      { chapter: 1 },
    ),
  ).rejects.toThrow("another user");
  const id = await service.enqueueChapter(fs, { chapter: 1 });
  await waitStatus(service, id, "AWAITING_CANDIDATE_APPROVAL");
  await expect(
    service.enqueueApproval(fs, id, "candidate", {
      confirmed: false,
      expectedSha256: "x",
    } as never),
  ).rejects.toThrow("Explicit");
  await expect(
    service.enqueueApproval(fs, id, "candidate", {
      confirmed: true,
      expectedSha256: "f".repeat(64),
    }),
  ).rejects.toThrow("stale");
}, 30000);
it("cancels a queued run without generating a chapter or model cost", async () => {
  const { service, fs } = await fixture();
  cleanups.push(() => service.stop());
  const id = await service.enqueueChapter(fs, { chapter: 1 });
  await service.cancel(fs, id);
  await service.handle({
    kind: "chapter",
    projectId: fs.projectId,
    ownerId: fs.ownerId,
    runId: id,
  });
  expect((await loadRun(fs, id)).status).toBe("CANCELLED");
  expect(
    (
      await service.db.pool.query("SELECT 1 FROM role_runs WHERE run_id=$1", [
        id,
      ])
    ).rowCount,
  ).toBe(0);
}, 30000);

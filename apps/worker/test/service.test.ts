import { randomUUID } from "node:crypto";
import { PostgresFS } from "@ruwen/db";
import { loadRun } from "@ruwen/pipeline";
import { afterEach, expect, it } from "vitest";
import { fixture, waitStatus } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];
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

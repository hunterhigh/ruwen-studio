import { randomUUID } from "node:crypto";
import { PostgresFS } from "@ruwen/db";
import { afterEach, expect, it } from "vitest";
import { fixture } from "../../../apps/worker/test/helpers.ts";
import { balance, dailyBudget, updateDailyLimit } from "../src/index.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function project() {
  const p = await fixture();
  cleanup.push(() => p.service.stop());
  return p;
}

it("concurrent projects reserve the daily budget atomically even when wallet funds can cover both", async () => {
  const p = await project(),
    db = p.service.db;
  await updateDailyLimit(db, p.fs.ownerId, 100000);
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'other','other')",
    [id, p.fs.ownerId],
  );
  const initial = await balance(db.pool, p.fs.ownerId, "sandbox");
  const accepted = await Promise.allSettled(
    [p.fs, new PostgresFS(db, id, p.fs.ownerId)].map((fs) =>
      p.service.enqueueChapter(fs, { chapter: 1 }),
    ),
  );
  expect(accepted.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    accepted.filter((r) => r.status === "rejected").map((r) => r.reason),
  ).toEqual([expect.objectContaining({ code: "INSUFFICIENT_CREDITS" })]);
  const projection = await dailyBudget(db.pool, p.fs.ownerId, "sandbox");
  expect(projection).toMatchObject({
    limit: "100000",
    used: "0",
    held: "100000",
    remaining: "0",
  });
  expect((await balance(db.pool, p.fs.ownerId, "sandbox")).balance).toBe(
    initial.balance,
  );
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM role_runs r JOIN pipeline_runs p ON p.id=r.run_id WHERE p.project_id=ANY($1::uuid[])",
        [[p.fs.projectId, id]],
      )
    ).rows[0]?.n,
  ).toBe(0);
});
it("UTC posting-day usage excludes previous days and payments, nets audited corrections, and keeps older review holds", async () => {
  const p = await project(),
    db = p.service.db;
  await updateDailyLimit(db, p.fs.ownerId, 200000);
  await db.pool.query(
    "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id,created_at) VALUES($1,'sandbox',-11000,'role_usage','role',$2,now()),($1,'sandbox',1000,'reconciliation','reservation',$3,now()),($1,'sandbox',-7000,'role_usage','role',$4,now()-interval '2 day'),($1,'sandbox',50000,'payment','fixture',$5,now())",
    [p.fs.ownerId, randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  );
  const runId = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  await db.pool.query(
    "UPDATE credit_reservations SET status='review',created_at=now()-interval '2 day' WHERE run_id=$1",
    [runId],
  );
  expect(await dailyBudget(db.pool, p.fs.ownerId, "sandbox")).toMatchObject({
    used: "10000",
    held: "100000",
    remaining: "90000",
    timezone: "UTC",
  });
  expect(await dailyBudget(db.pool, p.fs.ownerId, "live")).toMatchObject({
    used: "0",
    held: "0",
    remaining: "200000",
  });
});
it("the configured per-user chapter cap still applies with ample wallet and daily budget", async () => {
  const p = await project(),
    db = p.service.db;
  await updateDailyLimit(db, p.fs.ownerId, 1000000);
  await db.pool.query(
    "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'sandbox',1000000,'fixture','funding',$2)",
    [p.fs.ownerId, randomUUID()],
  );
  const projects = [p.fs];
  for (let i = 0; i < 2; i++) {
    const id = randomUUID();
    await db.pool.query(
      "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'cap-test','cap')",
      [id, p.fs.ownerId],
    );
    projects.push(new PostgresFS(db, id, p.fs.ownerId));
  }
  const accepted = await Promise.allSettled(
    projects.map((fs) => p.service.enqueueChapter(fs, { chapter: 1 })),
  );
  expect(accepted.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  expect(
    accepted.filter((r) => r.status === "rejected").map((r) => r.reason),
  ).toEqual([expect.objectContaining({ code: "PRECONDITION_FAILED" })]);
});
it("custom limits override configured plan defaults; reset and repeated changes are audited without changing credits", async () => {
  const p = await project(),
    db = p.service.db;
  const before = await balance(db.pool, p.fs.ownerId, "sandbox");
  expect(
    (await dailyBudget(db.pool, p.fs.ownerId, "sandbox")).defaultLimit,
  ).toBe("300000");
  await db.pool.query(
    "INSERT INTO subscriptions(user_id,provider,external_id,plan,status) VALUES($1,'fixture',$2,'preview','active')",
    [p.fs.ownerId, randomUUID()],
  );
  expect((await dailyBudget(db.pool, p.fs.ownerId, "sandbox")).limit).toBe(
    "30000",
  );
  await updateDailyLimit(db, p.fs.ownerId, 50000);
  await updateDailyLimit(db, p.fs.ownerId, 50000);
  expect((await dailyBudget(db.pool, p.fs.ownerId, "sandbox")).limit).toBe(
    "50000",
  );
  await updateDailyLimit(db, p.fs.ownerId, null);
  expect((await dailyBudget(db.pool, p.fs.ownerId, "sandbox")).limit).toBe(
    "30000",
  );
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM account_limit_audit WHERE user_id=$1",
        [p.fs.ownerId],
      )
    ).rows[0]?.n,
  ).toBe(2);
  expect(await balance(db.pool, p.fs.ownerId, "sandbox")).toEqual(before);
  await expect(
    db.pool.query(
      "UPDATE account_limit_audit SET new_limit=1 WHERE user_id=$1",
      [p.fs.ownerId],
    ),
  ).rejects.toThrow("append-only");
  await expect(db.pool.query("TRUNCATE account_limit_audit")).rejects.toThrow(
    "append-only",
  );
});

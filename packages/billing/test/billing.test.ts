import { randomUUID } from "node:crypto";
import { PostgresFS } from "@ruwen/db";
import { afterEach, expect, it, vi } from "vitest";
import { fixture } from "../../../apps/worker/test/helpers.ts";
import { runtimeSettings } from "../../../config/settings.ts";
import { balance, quoteRun } from "../src/index.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0)) await close();
});
async function project() {
  const p = await fixture();
  cleanup.push(() => p.service.stop());
  return p;
}
it("closing real charging does not disable faux or nonpaid trial admission", async () => {
  const p = await project();
  for (const bank of ["live", "sandbox"] as const) {
    const quote = await p.service.db.transaction((tx) =>
      quoteRun(tx, p.fs.ownerId, bank, "chapter"),
    );
    expect(quote.amount).toBe(
      runtimeSettings().billing.defaultReservations.chapter,
    );
  }
});

it("balance is the append-only ledger sum for each bank; sandbox funds cannot cover live holds", async () => {
  const p = await project(),
    db = p.service.db;
  const initial = await balance(db.pool, p.fs.ownerId, "sandbox");
  expect(initial.balance).toBe(String(runtimeSettings().billing.signupCredits));
  const grant = (
    await db.pool.query<{ id: string }>(
      "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'sandbox',17,'fixture','test',$2) RETURNING id",
      [p.fs.ownerId, randomUUID()],
    )
  ).rows[0];
  expect(
    BigInt((await balance(db.pool, p.fs.ownerId, "sandbox")).balance),
  ).toBe(BigInt(initial.balance) + 17n);
  expect((await balance(db.pool, p.fs.ownerId, "live")).balance).toBe(
    initial.balance,
  );
  await db.pool.query(
    "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'live',-$2::bigint,'fixture','deplete',$3)",
    [p.fs.ownerId, initial.balance, randomUUID()],
  );
  await expect(
    db.transaction((tx) => quoteRun(tx, p.fs.ownerId, "live", "chapter")),
  ).rejects.toMatchObject({ code: "INSUFFICIENT_CREDITS" });
  await expect(
    db.pool.query("UPDATE credit_ledger SET delta_credits=0 WHERE id=$1", [
      grant?.id,
    ]),
  ).rejects.toThrow("append-only");
  await expect(
    db.pool.query("DELETE FROM credit_ledger WHERE id=$1", [grant?.id]),
  ).rejects.toThrow("append-only");
  await expect(db.pool.query("TRUNCATE credit_ledger")).rejects.toThrow(
    "append-only",
  );
});

it("concurrent projects cannot over-reserve a shared account", async () => {
  const p = await project(),
    projects: PostgresFS[] = [p.fs];
  for (let index = 0; index < 2; index++) {
    const id = randomUUID();
    await p.service.db.pool.query(
      "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'balance-test','balance')",
      [id, p.fs.ownerId],
    );
    projects.push(new PostgresFS(p.service.db, id, p.fs.ownerId));
  }
  const accepted = await Promise.allSettled(
    projects.map((fs) => p.service.enqueueChapter(fs, { chapter: 1 })),
  );
  expect(accepted.filter((item) => item.status === "fulfilled")).toHaveLength(
    2,
  );
  const rejected = accepted.find((item) => item.status === "rejected");
  expect(rejected?.status === "rejected" && rejected.reason.code).toBe(
    "INSUFFICIENT_CREDITS",
  );
  const snapshot = await balance(p.service.db.pool, p.fs.ownerId, "sandbox");
  expect(BigInt(snapshot.reserved)).toBe(
    2n * BigInt(runtimeSettings().billing.defaultReservations.chapter),
  );
  expect(BigInt(snapshot.available)).toBeGreaterThanOrEqual(0n);
});

it("queue rejection atomically rolls back run and reservation without a debit", async () => {
  const p = await project();
  vi.spyOn(p.service.boss, "send").mockRejectedValueOnce(
    new Error("queue unavailable"),
  );
  const before = await balance(p.service.db.pool, p.fs.ownerId, "sandbox");
  await expect(p.service.enqueueChapter(p.fs, { chapter: 1 })).rejects.toThrow(
    "queue unavailable",
  );
  expect(await balance(p.service.db.pool, p.fs.ownerId, "sandbox")).toEqual(
    before,
  );
  expect(
    (
      await p.service.db.pool.query(
        "SELECT id FROM pipeline_runs WHERE project_id=$1",
        [p.fs.projectId],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await p.service.db.pool.query(
        "SELECT id FROM credit_reservations WHERE user_id=$1",
        [p.fs.ownerId],
      )
    ).rowCount,
  ).toBe(0);
});
it("an empty queue receipt also rolls back the reservation and task", async () => {
  const p = await project();
  vi.spyOn(p.service.boss, "send").mockResolvedValueOnce(null);
  await expect(p.service.enqueueChapter(p.fs, { chapter: 1 })).rejects.toThrow(
    "did not accept",
  );
  expect(
    (
      await p.service.db.pool.query(
        "SELECT id FROM pipeline_runs WHERE project_id=$1",
        [p.fs.projectId],
      )
    ).rowCount,
  ).toBe(0);
  expect(
    (await balance(p.service.db.pool, p.fs.ownerId, "sandbox")).reserved,
  ).toBe("0");
});

it("known cancellation settles actual usage exactly once then releases the remainder; redelivery cannot debit twice", async () => {
  const p = await project(),
    id = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  const task = {
    kind: "chapter" as const,
    projectId: p.fs.projectId,
    ownerId: p.fs.ownerId,
    runId: id,
  };
  expect((await p.service.handle(task))?.status).toBe(
    "AWAITING_CANDIDATE_APPROVAL",
  );
  const charges = (
    await p.service.db.pool.query<{ total: string; n: number }>(
      "SELECT (-coalesce(sum(delta_credits),0))::text total,count(*)::int n FROM credit_ledger WHERE user_id=$1 AND ref_type='role'",
      [p.fs.ownerId],
    )
  ).rows[0];
  expect(charges?.n).toBe(5);
  const expected = (
    await p.service.db.pool.query<{ total: string }>(
      "SELECT sum(ceil(c.cost_usd*$2::numeric*$3::numeric))::bigint::text total FROM role_cost_events c JOIN role_runs r ON r.id=c.role_run_id WHERE r.run_id=$1",
      [
        id,
        runtimeSettings().billing.costMarkup,
        runtimeSettings().billing.creditsPerUsd,
      ],
    )
  ).rows[0]?.total;
  expect(charges?.total).toBe(expected);
  await p.service.cancel(p.fs, id);
  await p.service.handle({ ...task, kind: "cancel" });
  const cancelled = await balance(p.service.db.pool, p.fs.ownerId, "sandbox");
  expect(cancelled.reserved).toBe("0");
  expect(cancelled.available).toBe(cancelled.balance);
  expect(BigInt(cancelled.balance)).toBe(
    BigInt(runtimeSettings().billing.signupCredits) - BigInt(expected ?? "0"),
  );
  await p.service.handle(task);
  await p.service.handle({ ...task, kind: "cancel" });
  expect(await balance(p.service.db.pool, p.fs.ownerId, "sandbox")).toEqual(
    cancelled,
  );
}, 30000);

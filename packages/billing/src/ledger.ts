import type { Database, PostgresFS } from "@ruwen/db";
import { releasePolicy, runtimeSettings } from "../../../config/settings.ts";

export type Bank = "live" | "sandbox";
export interface Sql {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}
export const projectSql = (tx: PostgresFS): Sql => ({
  query: (text, values = []) => tx.sql(text, values),
});
export type BillingCode =
  | "UNAUTHENTICATED"
  | "INSUFFICIENT_CREDITS"
  | "ACCOUNT_FROZEN"
  | "BILLING_DISABLED"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "PRECONDITION_FAILED"
  | "PROVIDER_UNAVAILABLE";
export class BillingError extends Error {
  readonly code: BillingCode;
  readonly status: number;
  constructor(code: BillingCode, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
export const currentBank = (): Bank =>
  ["real", "record"].includes(process.env.MODEL_MODE ?? "faux")
    ? "live"
    : "sandbox";
export async function initializeBilling(db: Database) {
  const settings = runtimeSettings();
  const threshold = Number(
    process.env.RUWEN_RISK_FREEZE_SCORE?.trim() ||
      settings.riskReview.freezeScore,
  );
  if (!Number.isSafeInteger(threshold) || threshold < 1)
    throw new Error("Invalid risk score threshold");
  await db.transaction(async (tx) => {
    await tx.query(
      "INSERT INTO billing_policy(id,signup_credits,risk_threshold) VALUES(true,$1,$2) ON CONFLICT(id) DO UPDATE SET signup_credits=excluded.signup_credits,risk_threshold=excluded.risk_threshold",
      [settings.billing.signupCredits, threshold],
    );
    await tx.query(
      "INSERT INTO billing_accounts(user_id) SELECT id FROM users ON CONFLICT DO NOTHING",
    );
    await tx.query(
      "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) SELECT u.id,b.bank,p.signup_credits,'signup','user',u.id::text FROM users u CROSS JOIN billing_policy p CROSS JOIN (VALUES('live'),('sandbox')) b(bank) ON CONFLICT DO NOTHING",
    );
    await tx.query("SELECT ruwen_refresh_risk(user_id) FROM billing_accounts");
  });
}
export async function lockAccount(tx: Sql, userId: string) {
  const row = (
    await tx.query<{ frozen_at: Date | null; reviewed_score: string }>(
      "SELECT frozen_at,reviewed_score::text FROM billing_accounts WHERE user_id=$1 FOR UPDATE",
      [userId],
    )
  ).rows[0];
  if (!row)
    throw new BillingError(
      "BILLING_DISABLED",
      403,
      "账户计费尚未就绪，暂不受理运行。",
    );
  return row;
}
export async function balance(tx: Sql, userId: string, bank: Bank) {
  const row = (
    await tx.query<{ balance: string; reserved: string; available: string }>(
      `
    SELECT total::text balance,held::text reserved,(total-held)::text available FROM
    (SELECT coalesce(sum(delta_credits),0) total FROM credit_ledger WHERE user_id=$1 AND bank=$2) a CROSS JOIN
    (SELECT coalesce(sum(remaining),0) held FROM credit_reservations WHERE user_id=$1 AND bank=$2 AND status IN ('active','review')) b`,
      [userId, bank],
    )
  ).rows[0];
  if (!row) throw new Error("Missing balance projection");
  return row;
}
export interface RunQuote {
  userId: string;
  bank: Bank;
  amount: number;
  markup: number;
  creditsPerUsd: number;
}
async function assertPaidFeature(tx: Sql, userId: string, bank: Bank) {
  if (bank !== "live") return;
  const paid = (
    await tx.query<{ paid: boolean }>(
      "SELECT (EXISTS(SELECT 1 FROM subscriptions WHERE user_id=$1 AND status='active') OR EXISTS(SELECT 1 FROM credit_ledger WHERE user_id=$1 AND bank='live' AND reason='payment')) paid",
      [userId],
    )
  ).rows[0]?.paid;
  if (paid && !releasePolicy().realChargingEnabled)
    throw new BillingError(
      "BILLING_DISABLED",
      403,
      "正式付费运行尚未开放，试用与模拟功能不受此收费开关影响。",
    );
}
export async function assertRunEnabled(
  tx: Sql,
  userId: string,
  runId?: string,
) {
  if ((await lockAccount(tx, userId)).frozen_at)
    throw new BillingError(
      "ACCOUNT_FROZEN",
      423,
      "账户运行已冻结，等待人工复核。",
    );
  if (runId) {
    const reservation = (
      await tx.query<{ bank: Bank; remaining: string }>(
        "SELECT bank,remaining::text FROM credit_reservations WHERE run_id=$1 AND user_id=$2",
        [runId, userId],
      )
    ).rows[0];
    if (reservation) {
      await assertPaidFeature(tx, userId, reservation.bank);
      const funds = await balance(tx, userId, reservation.bank);
      if (BigInt(funds.available) + BigInt(reservation.remaining) <= 0n)
        throw new BillingError(
          "INSUFFICIENT_CREDITS",
          402,
          "本次运行可用点数已耗尽，后续岗位尚未调用。",
        );
    }
  }
}
/** Caller has checked ownership and holds the SAME transaction through run insert + pg-boss send. */
export async function quoteRun(
  tx: Sql,
  userId: string,
  bank: Bank,
  kind: "chapter" | "ideation" | "memory",
): Promise<RunQuote> {
  const account = await lockAccount(tx, userId);
  if (account.frozen_at)
    throw new BillingError(
      "ACCOUNT_FROZEN",
      423,
      "账户运行已冻结，等待人工复核。",
    );
  const config = runtimeSettings().billing;
  await assertPaidFeature(tx, userId, bank);
  const amount = config.defaultReservations[kind];
  if (BigInt((await balance(tx, userId, bank)).available) < BigInt(amount))
    throw new BillingError(
      "INSUFFICIENT_CREDITS",
      402,
      "可用点数不足，请到账户页查看余额与预留。",
    );
  return {
    userId,
    bank,
    amount,
    markup: config.costMarkup,
    creditsPerUsd: config.creditsPerUsd,
  };
}
export async function reserveRun(tx: Sql, runId: string, quote: RunQuote) {
  await tx.query(
    "INSERT INTO credit_reservations(user_id,run_id,bank,amount,remaining,status,cost_markup,credits_per_usd) VALUES($1,$2,$3,$4,$4,'active',$5,$6)",
    [
      quote.userId,
      runId,
      quote.bank,
      quote.amount,
      quote.markup,
      quote.creditsPerUsd,
    ],
  );
}
/** Persist in the same transaction as role result/usage. DB uniqueness is the recovery boundary. */
export async function settleRole(
  tx: Sql,
  userId: string,
  runId: string,
  roleRunId: string,
) {
  await lockAccount(tx, userId);
  const reservation = (
    await tx.query<{
      id: string;
      bank: Bank;
      cost_markup: string;
      credits_per_usd: string;
    }>(
      "SELECT id,bank,cost_markup::text,credits_per_usd::text FROM credit_reservations WHERE run_id=$1 AND user_id=$2 FOR UPDATE",
      [runId, userId],
    )
  ).rows[0];
  if (!reservation) return; // Pre-P6 admitted runs are not retroactively charged.
  const cost = (
    await tx.query<{ credits: string }>(
      `SELECT ceil(coalesce((SELECT sum((entry->'cost'->>'total')::numeric) FROM jsonb_array_elements(r.usage) entry),0)*$3::numeric*$4::numeric)::bigint::text credits FROM role_runs r JOIN pipeline_runs pr ON pr.id=r.run_id JOIN projects p ON p.id=pr.project_id WHERE r.id=$1 AND r.run_id=$2 AND p.owner_id=$5 AND r.status IN ('completed','failed')`,
      [
        roleRunId,
        runId,
        reservation.cost_markup,
        reservation.credits_per_usd,
        userId,
      ],
    )
  ).rows[0];
  if (!cost || BigInt(cost.credits) < 0n)
    throw new Error("Invalid actual usage cost");
  const written = await tx.query(
    "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,$2,-$3::bigint,'role_usage','role',$4) ON CONFLICT DO NOTHING RETURNING id",
    [userId, reservation.bank, cost.credits, roleRunId],
  );
  if (written.rowCount)
    await tx.query(
      "UPDATE credit_reservations SET remaining=greatest(0,remaining-$2::bigint) WHERE id=$1",
      [reservation.id, cost.credits],
    );
}
export async function finishReservation(
  tx: Sql,
  userId: string,
  runId: string,
) {
  await lockAccount(tx, userId);
  const unknown = (
    await tx.query<{ unknown: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM role_runs WHERE run_id=$1 AND (status='running' OR usage_unknown)) unknown",
      [runId],
    )
  ).rows[0]?.unknown;
  await tx.query(
    "UPDATE credit_reservations SET status=$3,remaining=CASE WHEN $3='review' THEN remaining ELSE 0 END WHERE run_id=$1 AND user_id=$2 AND status IN ('active','review')",
    [runId, userId, unknown ? "review" : "released"],
  );
}
export async function unfreezeAccount(
  db: Database,
  userId: string,
  actorId: string,
  expectedFrozenAt: string,
) {
  return db.transaction(async (tx) => {
    const account = await lockAccount(tx, userId);
    if (
      !account.frozen_at ||
      account.frozen_at.toISOString() !== expectedFrozenAt
    )
      throw new BillingError(
        "PRECONDITION_FAILED",
        409,
        "冻结状态已改变，请刷新后重新复核。",
      );
    const score =
      (
        await tx.query<{ score: string }>(
          "SELECT coalesce(sum(score),0)::text score FROM security_events WHERE user_id=$1",
          [userId],
        )
      ).rows[0]?.score ?? "0";
    await tx.query(
      "UPDATE billing_accounts SET frozen_at=null,reviewed_score=$2::bigint WHERE user_id=$1",
      [userId, score],
    );
    await tx.query(
      "INSERT INTO account_risk_audit(user_id,actor_id,action,score) VALUES($1,$2,'unfreeze',$3)",
      [userId, actorId, score],
    );
    return { unfrozen: true };
  });
}

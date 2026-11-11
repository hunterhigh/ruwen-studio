import type { Database } from "@ruwen/db";
import { runtimeSettings } from "../../../config/settings.ts";
import { type Bank, BillingError, lockAccount, type Sql } from "./ledger.ts";

/** UTC posting-day net usage; all unfinished reservations (including prior days) still consume budget. */
export async function dailyBudget(tx: Sql, userId: string, bank: Bank) {
  const settings = runtimeSettings();
  const row = (
    await tx.query<{ custom: string | null; plan: string | null }>(
      "SELECT a.daily_credit_limit::text custom,s.plan FROM billing_accounts a LEFT JOIN subscriptions s ON s.user_id=a.user_id AND s.status='active' WHERE a.user_id=$1",
      [userId],
    )
  ).rows[0];
  if (!row) throw new BillingError("BILLING_DISABLED", 403, "账户尚未就绪。");
  const plan =
    settings.billing.plans.find((p) => p.id === row.plan) ??
    settings.billing.plans.find(
      (p) => p.id === settings.riskReview.dailyDefaultPlanId,
    );
  if (!plan) throw new Error("Daily default plan missing");
  const defaultLimit =
    (BigInt(plan.credits) * BigInt(settings.riskReview.dailyPlanPercent) +
      99n) /
    100n;
  const facts = (
    await tx.query<{ day: string; used: string; held: string }>(
      `SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD') AS "day",
    (SELECT greatest(0,-coalesce(sum(delta_credits),0))::text FROM credit_ledger WHERE user_id=$1 AND bank=$2 AND reason IN ('role_usage','reconciliation') AND created_at >= (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AND created_at < (date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '1 day') used,
    (SELECT coalesce(sum(remaining),0)::text FROM credit_reservations WHERE user_id=$1 AND bank=$2 AND status IN ('active','review')) held`,
      [userId, bank],
    )
  ).rows[0];
  if (!facts) throw new Error("Missing daily projection");
  const limit = row.custom === null ? defaultLimit : BigInt(row.custom);
  const remaining = limit - BigInt(facts.used) - BigInt(facts.held);
  return {
    ...facts,
    limit: String(limit),
    customLimit: row.custom,
    defaultLimit: String(defaultLimit),
    remaining: String(remaining > 0n ? remaining : 0n),
    maximum: settings.riskReview.dailyMaximumCredits,
    timezone: "UTC" as const,
  };
}
export async function assertDailyBudget(
  tx: Sql,
  userId: string,
  bank: Bank,
  requested = 0,
) {
  const budget = await dailyBudget(tx, userId, bank);
  if (
    BigInt(budget.used) + BigInt(budget.held) + BigInt(requested) >
    BigInt(budget.limit)
  )
    throw new BillingError(
      "INSUFFICIENT_CREDITS",
      402,
      "今日点数额度不足。请到账户页查看用量、预留或调整每日上限。",
    );
}
export async function updateDailyLimit(
  db: Database,
  userId: string,
  limit: unknown,
) {
  if (
    limit !== null &&
    (typeof limit !== "number" ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > runtimeSettings().riskReview.dailyMaximumCredits)
  )
    throw new BillingError(
      "INVALID_ARGUMENT",
      400,
      "每日上限须为配置范围内的正整数，或恢复默认值。",
    );
  await db.transaction(async (tx) => {
    await lockAccount(tx, userId);
    const previous =
      (
        await tx.query<{ value: string | null }>(
          "SELECT daily_credit_limit::text value FROM billing_accounts WHERE user_id=$1",
          [userId],
        )
      ).rows[0]?.value ?? null;
    const next = limit === null ? null : String(limit);
    if (previous === next) return;
    await tx.query(
      "UPDATE billing_accounts SET daily_credit_limit=$2 WHERE user_id=$1",
      [userId, next],
    );
    await tx.query(
      "INSERT INTO account_limit_audit(user_id,actor_id,previous_limit,new_limit) VALUES($1,$1,$2,$3)",
      [userId, previous, next],
    );
  });
}

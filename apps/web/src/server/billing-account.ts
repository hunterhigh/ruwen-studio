import { balance, currentBank, dailyBudget } from "@ruwen/billing";
import type { Database } from "@ruwen/db";
import { isLocalRealPreview } from "../../../../config/real-preview.ts";
import { releasePolicy, runtimeSettings } from "../../../../config/settings.ts";

export async function billingAccount(
  db: Database,
  userId: string,
  sandboxEnabled: boolean,
) {
  return db.transaction(
    async (tx) => {
      const live = await balance(tx, userId, "live"),
        sandbox = await balance(tx, userId, "sandbox"),
        bank = currentBank();
      const accounts = await tx.query<{ frozen_at: Date | null }>(
        "SELECT frozen_at FROM billing_accounts WHERE user_id=$1",
        [userId],
      );
      const usage = await tx.query<{
        id: string;
        run_id: string;
        role_id: string;
        model: string;
        usage: unknown;
        cost_usd: string | null;
        usage_unknown: boolean;
        started_at: Date;
        mode: string | null;
        title: string;
        charged_credits: string | null;
        bank: string | null;
      }>(
        "SELECT r.id,r.run_id,r.role_id,r.model,r.usage,r.cost_usd,r.usage_unknown,r.started_at,r.result->>'runtimeMode' AS mode,p.title,(-c.delta_credits)::text charged_credits,c.bank FROM role_runs r JOIN pipeline_runs pr ON pr.id=r.run_id JOIN projects p ON p.id=pr.project_id LEFT JOIN credit_ledger c ON c.ref_type='role' AND c.ref_id=r.id::text AND c.reason='role_usage' AND c.user_id=$1 WHERE p.owner_id=$1 ORDER BY r.started_at DESC LIMIT 100",
        [userId],
      );
      const ledger = await tx.query<{
        id: string;
        bank: string;
        delta_credits: string;
        reason: string;
        created_at: Date;
      }>(
        "SELECT id,bank,delta_credits::text,reason,created_at FROM credit_ledger WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100",
        [userId],
      );
      const reservations = await tx.query<{
        id: string;
        run_id: string;
        bank: string;
        amount: string;
        remaining: string;
        status: string;
        held_usd: string;
      }>(
        "SELECT id,run_id,bank,amount::text,remaining::text,status,(remaining/cost_markup/credits_per_usd)::text held_usd FROM credit_reservations WHERE user_id=$1 AND status IN ('active','review') ORDER BY created_at DESC",
        [userId],
      );
      const checkouts = await tx.query<{
        id: string;
        provider: string;
        plan_id: string;
        credits: string;
        price_minor: number;
        status: string;
        external_url: string | null;
        prepared_at: Date | null;
      }>(
        "SELECT id,provider,plan_id,credits::text,price_minor,status,external_url,prepared_at FROM billing_checkouts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
        [userId],
      );
      const reviews = await tx.query<{
        id: string;
        run_id: string;
        action: string;
        actual_cost_usd: string | null;
        charged_credits: string;
        reason: string;
        created_at: Date;
      }>(
        "SELECT v.id,r.run_id,v.action,v.actual_cost_usd::text,v.charged_credits::text,v.reason,v.created_at FROM credit_reservation_reviews v JOIN credit_reservations r ON r.id=v.reservation_id WHERE r.user_id=$1 ORDER BY v.created_at DESC LIMIT 100",
        [userId],
      );
      return {
        balance: (bank === "live" ? live : sandbox).balance,
        localRealPreview: isLocalRealPreview(),
        bank,
        banks: { live, sandbox },
        daily: {
          live: await dailyBudget(tx, userId, "live"),
          sandbox: await dailyBudget(tx, userId, "sandbox"),
        },
        frozenAt: accounts.rows[0]?.frozen_at?.toISOString() ?? null,
        usage: usage.rows,
        ledger: ledger.rows,
        reservations: reservations.rows,
        reviews: reviews.rows,
        checkouts: checkouts.rows,
        sandboxEnabled,
        plans: runtimeSettings().billing.plans,
        release: releasePolicy(),
        calibration: runtimeSettings().calibration,
      };
    },
    { readOnly: true },
  );
}

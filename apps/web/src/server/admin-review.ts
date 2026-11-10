import type { Database } from "@ruwen/db";
import { securityLimits } from "../../../../config/security.ts";
import { runtimeSettings } from "../../../../config/settings.ts";
export type AdminAction =
  | "dashboard_page"
  | "dashboard_data"
  | "account_unfreeze"
  | "invitation_create";
export function adminAllowed(emails: string[], email: string) {
  return emails.includes(email.toLowerCase());
}
/** No model text, raw URLs, tokens, query strings or deployment thresholds enter this ledger. */
export async function auditAdmin(
  executor: { query: (sql: string, values: unknown[]) => Promise<unknown> },
  actorId: string | null,
  action: AdminAction,
  allowed: boolean,
) {
  await executor.query(
    "INSERT INTO web_admin_audit(actor_id,action,outcome) VALUES($1,$2,$3)",
    [actorId, action, allowed ? "allowed" : "denied"],
  );
}
/** Read-only projection of existing backend risk facts; no threshold or freeze decisions are made here. */
export async function adminRiskReview(db: Database) {
  const policy = (
    await db.pool.query<{ risk_threshold: number }>(
      "SELECT risk_threshold FROM billing_policy WHERE id=true",
    )
  ).rows[0];
  const accounts = await db.pool.query<{
    id: string;
    email: string;
    score: string;
    events: number;
    last_event: Date | null;
    frozen_at: Date | null;
  }>(
    "SELECT u.id,u.email,coalesce(sum(s.score),0)::text score,count(s.id)::int events,max(s.created_at) last_event,a.frozen_at FROM users u LEFT JOIN security_events s ON s.user_id=u.id LEFT JOIN billing_accounts a ON a.user_id=u.id GROUP BY u.id,a.frozen_at ORDER BY coalesce(sum(s.score),0) DESC,u.created_at DESC LIMIT 100",
  );
  const audit = await db.pool.query<{
    id: string;
    actor_id: string | null;
    action: string;
    outcome: string;
    created_at: Date;
  }>(
    "SELECT id,actor_id,action,outcome,created_at FROM web_admin_audit ORDER BY created_at DESC,id DESC LIMIT 100",
  );
  const riskAudit = await db.pool.query<{
    id: string;
    user_id: string;
    actor_id: string | null;
    action: string;
    score: string;
    created_at: Date;
  }>(
    "SELECT id,user_id,actor_id,action,score::text,created_at FROM account_risk_audit ORDER BY created_at DESC LIMIT 100",
  );
  return {
    enforcement: "active" as const,
    enforcedLimits: { freezeScore: policy?.risk_threshold ?? null },
    calibration: runtimeSettings().calibration.label,
    designLimits: {
      ...runtimeSettings().riskReview,
      coordinatorMessageChars: securityLimits().chatChars,
    },
    accounts: accounts.rows.map((row) => ({
      id: row.id,
      email: row.email,
      score: Number(row.score),
      events: row.events,
      lastEvent: row.last_event?.toISOString() ?? null,
      frozenAt: row.frozen_at?.toISOString() ?? null,
    })),
    riskAudit: riskAudit.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      actorId: row.actor_id,
      action: row.action,
      score: row.score,
      at: row.created_at.toISOString(),
    })),
    audit: audit.rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      outcome: row.outcome,
      at: row.created_at.toISOString(),
    })),
  };
}
export type AdminRiskReview = Awaited<ReturnType<typeof adminRiskReview>>;

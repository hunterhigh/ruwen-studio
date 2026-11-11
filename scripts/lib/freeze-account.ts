import { lockAccount } from "../../packages/billing/src/index.ts";
import type { Database } from "../../packages/db/src/index.ts";

/** Offline operator command; same account lock and append-only risk audit as automatic freezes. */
export async function freezeForOperations(
  db: Database,
  userId: string,
  actorId: string,
  administratorEmails: string[],
) {
  if (
    ![userId, actorId].every((id) =>
      /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id),
    )
  )
    throw new Error("Valid account identifiers required");
  return await db.transaction(async (tx) => {
    const actor = (
      await tx.query<{ email: string }>("SELECT email FROM users WHERE id=$1", [
        actorId,
      ])
    ).rows[0];
    if (
      !actor ||
      !administratorEmails
        .map((email) => email.trim().toLowerCase())
        .includes(actor.email.toLowerCase())
    )
      throw new Error("Authorized administrator required");
    const account = await lockAccount(tx, userId);
    if (account.frozen_at) return { frozen: true, changed: false };
    const score =
      (
        await tx.query<{ score: string }>(
          "SELECT coalesce(sum(score),0)::text score FROM security_events WHERE user_id=$1",
          [userId],
        )
      ).rows[0]?.score ?? "0";
    await tx.query(
      "UPDATE billing_accounts SET frozen_at=clock_timestamp(),frozen_score=$2 WHERE user_id=$1",
      [userId, score],
    );
    await tx.query(
      "INSERT INTO account_risk_audit(user_id,actor_id,action,score) VALUES($1,$2,'freeze',$3)",
      [userId, actorId, score],
    );
    return { frozen: true, changed: true };
  });
}

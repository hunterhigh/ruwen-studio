import type { Database } from "@ruwen/db";
import { BillingError, lockAccount } from "./ledger.ts";

/** Server has authenticated the admin and checked the target resource before this call. */
export async function resolveReservation(
  db: Database,
  actorId: string,
  reservationId: string,
  input: {
    action: "settle" | "release";
    actualCostUsd?: string;
    reason: string;
    expectedRemaining: string;
  },
) {
  if (
    !["settle", "release"].includes(input.action) ||
    !input.reason.trim() ||
    input.reason.length > 2000 ||
    !/^\d+$/.test(input.expectedRemaining) ||
    (input.action === "settle" &&
      !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/.test(input.actualCostUsd ?? ""))
  )
    throw new BillingError(
      "INVALID_ARGUMENT",
      400,
      "请填写处理方式、有效的实际费用和核对理由。",
    );
  return db.transaction(async (tx) => {
    const owner = (
      await tx.query<{ user_id: string }>(
        "SELECT user_id FROM credit_reservations WHERE id=$1",
        [reservationId],
      )
    ).rows[0];
    if (!owner) throw new BillingError("NOT_FOUND", 404, "预留不存在。");
    await lockAccount(tx, owner.user_id);
    const reservation = (
      await tx.query<{
        run_id: string;
        bank: string;
        remaining: string;
        status: string;
        cost_markup: string;
        credits_per_usd: string;
      }>(
        "SELECT run_id,bank,remaining::text,status,cost_markup::text,credits_per_usd::text FROM credit_reservations WHERE id=$1 FOR UPDATE",
        [reservationId],
      )
    ).rows[0];
    if (
      !reservation ||
      reservation.status !== "review" ||
      reservation.remaining !== input.expectedRemaining
    )
      throw new BillingError(
        "PRECONDITION_FAILED",
        409,
        "预留状态已改变，请刷新后重新核对。",
      );
    const known =
      (
        await tx.query<{ charged: string }>(
          "SELECT coalesce(-sum(c.delta_credits),0)::text charged FROM credit_ledger c JOIN role_runs r ON c.ref_type='role' AND c.ref_id=r.id::text WHERE r.run_id=$1 AND c.user_id=$2 AND c.bank=$3 AND c.reason='role_usage'",
          [reservation.run_id, owner.user_id, reservation.bank],
        )
      ).rows[0]?.charged ?? "0";
    const charged =
      input.action === "release"
        ? known
        : (
            await tx.query<{ total: string }>(
              "SELECT ceil($1::numeric*$2::numeric*$3::numeric)::bigint::text total",
              [
                input.actualCostUsd,
                reservation.cost_markup,
                reservation.credits_per_usd,
              ],
            )
          ).rows[0]?.total;
    if (charged === undefined) throw new Error("Missing reconciliation total");
    if (input.action === "settle")
      await tx.query(
        "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,$2,$3::bigint,'reconciliation','reservation',$4)",
        [
          owner.user_id,
          reservation.bank,
          String(BigInt(known) - BigInt(charged)),
          reservationId,
        ],
      );
    await tx.query(
      "INSERT INTO credit_reservation_reviews(reservation_id,actor_id,action,actual_cost_usd,charged_credits,reason) VALUES($1,$2,$3,$4,$5,$6)",
      [
        reservationId,
        actorId,
        input.action,
        input.action === "settle" ? input.actualCostUsd : null,
        charged,
        input.reason.trim(),
      ],
    );
    await tx.query(
      "UPDATE credit_reservations SET status='released',remaining=0 WHERE id=$1",
      [reservationId],
    );
    await tx.query(
      "INSERT INTO web_admin_audit(actor_id,action,outcome) VALUES($1,'reservation_resolve','allowed')",
      [actorId],
    );
    return { resolved: true, chargedCredits: charged };
  });
}

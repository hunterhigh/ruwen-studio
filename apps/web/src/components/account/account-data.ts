import { accountCopy as copy } from "../../copy/zh-CN.ts";
import type { billingAccount } from "../../server/billing-account.ts";
import { displayError } from "../../ui/error-text.ts";
import { ApiError } from "../client.ts";

type Projection = Awaited<ReturnType<typeof billingAccount>>;

export const banks = ["live", "sandbox"] as const;
export type Bank = (typeof banks)[number];

type UsageRow = Pick<
  Projection["usage"][number],
  "id" | "run_id" | "title" | "role_id" | "charged_credits" | "bank"
> & { started_at: string };

type LedgerRow = Pick<
  Projection["ledger"][number],
  "id" | "bank" | "delta_credits" | "reason"
> & { created_at: string };

export type Checkout = Pick<
  Projection["checkouts"][number],
  "id" | "provider" | "plan_id" | "credits" | "status" | "external_url"
> & { prepared_at: string | null };

export type AccountData = Pick<
  Projection,
  "bank" | "banks" | "daily" | "frozenAt" | "sandboxEnabled" | "plans"
> & {
  user: { id: string; email: string };
  usage: UsageRow[];
  ledger: LedgerRow[];
  reservations: Pick<
    Projection["reservations"][number],
    "id" | "run_id" | "bank" | "remaining" | "status"
  >[];
  reviews: Pick<
    Projection["reviews"][number],
    "id" | "run_id" | "action" | "charged_credits" | "reason"
  >[];
  checkouts: Checkout[];
};

const numberFormat = new Intl.NumberFormat("zh-CN");
const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "short",
  timeStyle: "short",
});

export function formatCredits(value: string | number | bigint) {
  return numberFormat.format(BigInt(value));
}

export function accountText(value: string) {
  return value
    .replace(/(?:USD\s*\$?|\$)\s*\d[\d,.]*/gi, copy.hiddenDetail)
    .replace(/USD|\$|tokens?|缓存/gi, copy.hiddenDetail);
}

export function accountError(error: unknown) {
  return displayError(
    error instanceof ApiError ? error.code : undefined,
    copy.requestFailed,
  );
}

export function timeLabel(value: string | undefined) {
  const date = value ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime())
    ? timeFormat.format(date)
    : undefined;
}

export function bankLabel(value: string | null) {
  if (value === "live" || value === "sandbox") return copy.banks[value];
  return undefined;
}

export function groupUsage(usage: UsageRow[]) {
  const groups = new Map<string, UsageRow[]>();
  for (const row of usage) {
    const rows = groups.get(row.run_id);
    if (rows) rows.push(row);
    else groups.set(row.run_id, [row]);
  }
  return [...groups].map(([id, roles]) => {
    let timestamp: string | undefined;
    let total: bigint | null = 0n;
    for (const role of roles) {
      if (
        Number.isFinite(Date.parse(role.started_at)) &&
        (timestamp === undefined ||
          Date.parse(role.started_at) < Date.parse(timestamp))
      ) {
        timestamp = role.started_at;
      }
      total =
        total === null || role.charged_credits === null
          ? null
          : total + BigInt(role.charged_credits);
    }
    return { id, roles, timestamp, total, title: roles[0]?.title ?? "" };
  });
}

export function accountActivity(data: Pick<AccountData, "usage" | "ledger">) {
  const runs = groupUsage(data.usage);
  return {
    runs,
    activity: [
      ...runs.map((run) => ({
        type: "run" as const,
        timestamp: run.timestamp,
        run,
      })),
      ...data.ledger
        .filter((entry) => entry.reason !== "role_usage")
        .map((entry) => ({
          type: "ledger" as const,
          timestamp: entry.created_at,
          entry,
        })),
    ].sort((a, b) => {
      const before = a.timestamp ? Date.parse(a.timestamp) : NaN;
      const after = b.timestamp ? Date.parse(b.timestamp) : NaN;
      if (!Number.isFinite(before)) return Number.isFinite(after) ? 1 : 0;
      if (!Number.isFinite(after)) return -1;
      return after - before;
    }),
  };
}

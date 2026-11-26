import { type FormEvent, useState } from "react";
import { accountCopy as copy, errorCopy } from "../../copy/zh-CN.ts";
import { Button } from "../../ui/Button.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { post } from "../client.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import {
  type AccountData,
  accountError,
  banks,
  formatCredits,
} from "./account-data.ts";

export function BalanceCard({
  data,
  refresh,
  onPurchase,
}: {
  data: AccountData;
  refresh: () => Promise<AccountData | undefined>;
  onPurchase: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState("");
  const budget = data.daily[data.bank];
  const warning = data.frozenAt
    ? errorCopy.ACCOUNT_FROZEN
    : BigInt(budget.remaining) === 0n ||
        BigInt(data.banks[data.bank].available) <= 0n
      ? errorCopy.INSUFFICIENT_CREDITS
      : !data.sandboxEnabled
        ? errorCopy.BILLING_DISABLED
        : "";

  async function save(limitCredits: number | null) {
    if (saving) return;
    setInvalid("");
    if (
      limitCredits !== null &&
      (!Number.isSafeInteger(limitCredits) ||
        limitCredits < 1 ||
        limitCredits > budget.maximum)
    ) {
      setInvalid(copy.invalidLimit);
      return;
    }
    setSaving(true);
    try {
      await post(`/api/billing/accounts/${data.user.id}/daily-limit`, {
        limitCredits,
      });
      await refresh();
      toast(limitCredits === null ? copy.restoredNotice : copy.savedNotice);
    } catch (error) {
      setInvalid(accountError(error));
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(Number(new FormData(event.currentTarget).get("limitCredits")));
  }

  function toggleLimit() {
    setInvalid("");
    setEditing((visible) => !visible);
  }

  return (
    <section className="account-panel account-balance">
      {warning && (
        <p className="account-warning" role="alert">
          {warning}
        </p>
      )}
      <h2>{copy.balance}</h2>
      {banks.map((bank) => {
        const balance = data.banks[bank];
        const daily = data.daily[bank];
        return (
          <section
            className="account-bank"
            aria-label={copy.banks[bank]}
            key={bank}
          >
            <h3>
              {copy.banks[bank]}
              {data.bank === bank && <small>{copy.currentBank}</small>}
            </h3>
            <p className="account-balance-label">{copy.available}</p>
            <p className="account-balance-value">
              {formatCredits(balance.available)} <small>{copy.credits}</small>
            </p>
            <dl>
              <div>
                <dt>{copy.reserved}</dt>
                <dd>{copy.points(formatCredits(balance.reserved))}</dd>
              </div>
              <div>
                <dt>{copy.dailyUsed}</dt>
                <dd>
                  {copy.dailyPair(
                    formatCredits(daily.used),
                    formatCredits(daily.limit),
                  )}
                </dd>
              </div>
            </dl>
          </section>
        );
      })}
      <p className="account-muted account-utc">{copy.utc}</p>
      <div className="account-actions">
        <Button variant="primary" onClick={onPurchase}>
          {copy.purchase}
        </Button>
        <Button aria-expanded={editing} onClick={toggleLimit} disabled={saving}>
          {copy.changeLimit}
        </Button>
      </div>
      {editing && (
        <section className="account-limit" aria-label={copy.dailyLimit}>
          <p>{copy.limitExplanation}</p>
          <form key={budget.limit} onSubmit={submit} noValidate>
            <label>
              {copy.dailyLimit}
              <input
                name="limitCredits"
                type="number"
                min={1}
                max={budget.maximum}
                step={1}
                required
                defaultValue={budget.limit}
                disabled={saving}
              />
            </label>
            <p className="account-muted">
              {copy.limitRange(
                formatCredits(budget.maximum),
                formatCredits(budget.defaultLimit),
              )}
            </p>
            {invalid && (
              <p className="account-warning" role="alert">
                <SafeMarkdown plain inline content={invalid} />
              </p>
            )}
            <div className="account-actions">
              <Button type="submit" variant="primary" disabled={saving}>
                {copy.saveLimit}
              </Button>
              <Button
                disabled={saving || budget.customLimit === null}
                onClick={() => void save(null)}
              >
                {copy.restoreDefault}
              </Button>
              <Button variant="ghost" disabled={saving} onClick={toggleLimit}>
                {copy.cancelLimit}
              </Button>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}

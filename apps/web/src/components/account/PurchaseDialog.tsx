import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  confirmation,
  accountCopy as copy,
  errorCopy,
} from "../../copy/zh-CN.ts";
import { Button } from "../../ui/Button.tsx";
import { useConfirm } from "../../ui/ConfirmDialog.tsx";
import { useToast } from "../../ui/Toast.tsx";
import { ApiError, post } from "../client.ts";
import { SafeMarkdown, safeLink } from "../SafeMarkdown.tsx";
import {
  type AccountData,
  accountError,
  accountText,
  formatCredits,
} from "./account-data.ts";

type ActiveCheckout = {
  id: string;
  provider: string;
  credits: string | number;
  url: string | null;
};

export function PurchaseDialog({
  data,
  refresh,
  onDismiss,
}: {
  data: AccountData;
  refresh: () => Promise<AccountData | undefined>;
  onDismiss: () => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const dialog = useRef<HTMLDialogElement>(null);
  const requests = useRef(new Map<string, string>());
  const title = useId();
  const [planId, setPlanId] = useState(data.plans[0]?.id);
  const [checkout, setCheckout] = useState<ActiveCheckout>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{
    code: string | undefined;
    message: string;
  }>();
  const plan = data.plans.find((value) => value.id === planId);
  const disabled = !data.sandboxEnabled || failure?.code === "BILLING_DISABLED";
  const frozen = Boolean(data.frozenAt) || failure?.code === "ACCOUNT_FROZEN";
  const blocked = disabled || frozen;
  const warning = frozen
    ? errorCopy.ACCOUNT_FROZEN
    : disabled
      ? errorCopy.BILLING_DISABLED
      : failure?.message;

  useLayoutEffect(() => {
    const modal = dialog.current;
    if (!modal) return;
    const trigger = document.activeElement;
    modal.showModal();
    return () => {
      modal.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);

  async function withCheckout(action: () => Promise<void>) {
    setBusy(true);
    setFailure(undefined);
    try {
      await action();
    } catch (error) {
      setFailure({
        message: accountError(error),
        code: error instanceof ApiError ? error.code : undefined,
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function prepare() {
    if (!plan || busy || blocked) return;
    const requestId = requests.current.get(plan.id) ?? crypto.randomUUID();
    requests.current.set(plan.id, requestId);
    await withCheckout(async () => {
      const result = await post<{
        id: string;
        provider: string;
        url: string | null;
        sandbox: boolean;
      }>("/api/billing/checkout", {
        planId: plan.id,
        clientRequestId: requestId,
      });
      if (result.sandbox !== true)
        throw new ApiError(errorCopy.BILLING_DISABLED, "BILLING_DISABLED");
      const updated = await refresh();
      const saved = updated?.checkouts.find((row) => row.id === result.id);
      setCheckout({
        id: result.id,
        provider: result.provider,
        url: result.url,
        credits: saved?.credits ?? plan.credits,
      });
    });
  }

  async function complete() {
    if (!checkout || checkout.provider !== "mock" || busy || blocked) return;
    if (!(await confirm(confirmation.completePayment))) return;
    await withCheckout(async () => {
      const result = await post<{ accepted: boolean; duplicate: boolean }>(
        `/api/billing/checkouts/${checkout.id}/complete`,
      );
      if (!result.accepted) throw new Error();
      await refresh();
      toast(
        result.duplicate
          ? copy.alreadyPaid
          : copy.paid(formatCredits(checkout.credits)),
      );
      onDismiss();
    });
  }

  const external =
    checkout?.provider === "lemonsqueezy"
      ? safeLink(checkout.url ?? undefined)
      : undefined;

  async function openExternal() {
    if (!external || blocked) return;
    if (
      await confirm({
        ...confirmation.external,
        body: confirmation.external.body(new URL(external).origin),
      })
    ) {
      window.open(external, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <dialog
      className="ui-confirm-dialog account-purchase-dialog"
      ref={dialog}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDismiss();
      }}
    >
      <h2 id={title}>{copy.purchase}</h2>
      {warning && (
        <p className="account-warning" role="alert">
          <SafeMarkdown plain inline content={warning} />
        </p>
      )}
      {checkout ? (
        <>
          <p className="account-payment-note">{copy.sandboxNotice}</p>
          <p>{copy.checkoutPrepared(formatCredits(checkout.credits))}</p>
          <div className="ui-dialog-actions">
            <Button variant="ghost" disabled={busy} onClick={onDismiss}>
              {copy.close}
            </Button>
            {checkout.provider === "mock" ? (
              <Button
                variant="primary"
                disabled={blocked || busy}
                onClick={() => void complete()}
              >
                {copy.completePayment}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={blocked || !external}
                onClick={() => void openExternal()}
              >
                {copy.openTestCheckout}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          {!blocked && <p>{copy.sandboxNotice}</p>}
          {data.plans.length > 0 ? (
            <fieldset className="account-plans" disabled={blocked || busy}>
              <legend>{copy.choosePlan}</legend>
              {data.plans.map((option) => (
                <label key={option.id}>
                  <input
                    type="radio"
                    name="account-plan"
                    checked={option.id === planId}
                    onChange={() => setPlanId(option.id)}
                  />
                  <span>
                    <strong>
                      <SafeMarkdown
                        plain
                        inline
                        content={accountText(option.name)}
                      />
                    </strong>
                    <span>
                      {copy.testCredits(formatCredits(option.credits))}
                    </span>
                    {!option.priceMinor && <small>{copy.pricePending}</small>}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p>{copy.noPlans}</p>
          )}
          {data.checkouts.some((row) => row.status === "pending") && (
            <ul className="account-pending-checkouts">
              {data.checkouts
                .filter((row) => row.status === "pending")
                .map((row) => (
                  <li key={row.id}>
                    <span>{copy.testCredits(formatCredits(row.credits))}</span>
                    {row.prepared_at ? (
                      <Button
                        variant="ghost"
                        disabled={blocked || busy}
                        onClick={() =>
                          setCheckout({
                            id: row.id,
                            provider: row.provider,
                            credits: row.credits,
                            url: row.external_url,
                          })
                        }
                      >
                        {copy.resumeCheckout}
                      </Button>
                    ) : (
                      <span className="account-muted">
                        {copy.checkoutAwaitingReview}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          )}
          <div className="ui-dialog-actions">
            <Button variant="ghost" disabled={busy} onClick={onDismiss}>
              {copy.close}
            </Button>
            <Button
              variant="primary"
              disabled={blocked || busy || !plan}
              onClick={() => void prepare()}
            >
              {busy ? copy.preparingCheckout : copy.createCheckout}
            </Button>
          </div>
        </>
      )}
    </dialog>
  );
}

"use client";
import { type FormEvent, useState } from "react";
import { adminCopy, confirmation } from "../copy/zh-CN.ts";
import type { pendingReservations } from "../server/admin-review.ts";
import { Button } from "../ui/Button.tsx";
import { useConfirm } from "../ui/ConfirmDialog.tsx";
import { InlineNotice } from "../ui/InlineNotice.tsx";
import { ApiError, post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

const copy = adminCopy.review;
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  currencyDisplay: "code",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function resolveError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 400) return adminCopy.errors.reservationInvalid;
    if (error.status === 404 || error.status === 409)
      return adminCopy.errors.reservationUpdated;
  }
  return adminCopy.errors.reservationResolve;
}

export function AdminReservations() {
  const confirm = useConfirm();
  const {
    data,
    error: loadError,
    refresh,
  } = useApi<Awaited<ReturnType<typeof pendingReservations>>>(
    "/api/admin/reservations",
  );
  const [error, setError] = useState<{ id: string; text: string }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function resolve(
    event: FormEvent<HTMLFormElement>,
    id: string,
    remaining: string,
  ) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    if (!(await confirm(confirmation.resolveReservation))) return;
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await post(`/api/admin/reservations/${id}/resolve`, {
        confirmed: true,
        action: form.get("action"),
        actualCostUsd: form.get("cost"),
        reason: form.get("reason"),
        expectedRemaining: remaining,
      });
      await refresh();
      setNotice(copy.saved);
    } catch (caught) {
      setError({ id, text: resolveError(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-content admin-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">
            {adminCopy.section} / {adminCopy.billingReview}
          </span>
          <h1>{copy.heading}</h1>
        </div>
        <a className="ui-btn" href="/admin">
          {copy.back}
        </a>
      </header>
      <p className="admin-notice">{copy.guidance}</p>
      {loadError && (
        <InlineNotice
          message={adminCopy.errors.reservationList}
          actionLabel={adminCopy.reload}
          onAction={() => void refresh()}
        />
      )}
      {notice && <output className="admin-notice">{notice}</output>}
      {data?.length === 0 && (
        <section className="paper-panel admin-panel">
          <h2>{copy.noPending}</h2>
        </section>
      )}
      {data?.map((row) => (
        <section className="paper-panel admin-panel" key={row.id}>
          <h2>
            <SafeMarkdown plain inline content={row.email} />
          </h2>
          <dl className="admin-reservation-details">
            <div>
              <dt>{copy.runId}</dt>
              <dd>
                <SafeMarkdown plain inline content={row.run_id} />
              </dd>
            </div>
            <div>
              <dt>{copy.bank}</dt>
              <dd>
                {row.bank === "sandbox"
                  ? copy.sandbox
                  : row.bank === "live"
                    ? copy.live
                    : adminCopy.empty}
              </dd>
            </div>
            <div className="admin-number">
              <dt>{copy.remaining}</dt>
              <dd>{BigInt(row.remaining).toLocaleString("zh-CN")}</dd>
            </div>
            <div className="admin-number">
              <dt>{copy.held}</dt>
              <dd>{currency.format(Number(row.held_usd))}</dd>
            </div>
          </dl>
          <p className="admin-helper">{copy.heldNote}</p>
          <form
            className="admin-reservation-form"
            onSubmit={(event) => void resolve(event, row.id, row.remaining)}
          >
            <label>
              {copy.action}
              <select name="action" required disabled={busy}>
                <option value="settle">{copy.settle}</option>
                <option value="release">{copy.release}</option>
              </select>
            </label>
            <label>
              {copy.cost}
              <input
                className="admin-number"
                name="cost"
                type="text"
                inputMode="decimal"
                placeholder={copy.costExample}
                disabled={busy}
              />
            </label>
            <label>
              {copy.reason}
              <textarea
                name="reason"
                required
                maxLength={2000}
                disabled={busy}
              />
            </label>
            <Button variant="primary" type="submit" disabled={busy}>
              {copy.submit}
            </Button>
            {error?.id === row.id && (
              <InlineNotice
                message={error.text}
                actionLabel={adminCopy.reload}
                onAction={() => {
                  setError(undefined);
                  void refresh();
                }}
              />
            )}
          </form>
        </section>
      ))}
    </main>
  );
}

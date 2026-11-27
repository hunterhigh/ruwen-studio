"use client";
import { useState } from "react";
import { adminCopy, confirmation } from "../copy/zh-CN.ts";
import type { AdminRiskReview } from "../server/admin-review.ts";
import { Button } from "../ui/Button.tsx";
import { useConfirm } from "../ui/ConfirmDialog.tsx";
import { ApiError, post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";

const copy = adminCopy.risk;
const number = new Intl.NumberFormat("zh-CN");

function auditAction(action: string) {
  return Object.hasOwn(copy.actions, action)
    ? copy.actions[action as keyof typeof copy.actions]
    : copy.unknownAction;
}

export function AdminSecurity({
  review,
  onChanged,
}: {
  review: AdminRiskReview;
  onChanged?: () => Promise<unknown>;
}) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ id: string; text: string }>();
  const limits = review.designLimits;
  const freezeScore = review.enforcedLimits.freezeScore;
  const controls = [
    [
      copy.threshold,
      freezeScore === null
        ? copy.unconfigured
        : `${number.format(freezeScore)} ${copy.point}`,
      freezeScore === null ? copy.reference : copy.thresholdActive,
    ],
    [
      copy.userChapter,
      `${number.format(limits.userChapterConcurrency)} ${copy.item}`,
      copy.reference,
    ],
    [
      copy.project,
      `${number.format(limits.projectConcurrency)} ${copy.item}`,
      copy.projectLock,
    ],
    [
      copy.message,
      `${number.format(limits.coordinatorMessageChars)} ${copy.character}`,
      copy.inputLimit,
    ],
    [
      copy.turns,
      `${number.format(limits.coordinatorTurnsPerHour)} ${copy.turn}`,
      copy.reference,
    ],
    [
      copy.dailyUsage,
      adminCopy.risk.dailyPercent(number.format(limits.dailyPlanPercent)),
      copy.reference,
    ],
    [
      copy.trial,
      `${limits.trialChapterRange.map((value) => number.format(value)).join("–")} ${copy.chapter}`,
      copy.costCalibration,
    ],
  ];

  async function unfreeze(id: string, frozenAt: string | null) {
    if (busy || !frozenAt || !(await confirm(confirmation.unfreeze))) return;
    setBusy(true);
    setError(undefined);
    try {
      await post(`/api/admin/accounts/${id}/unfreeze`, {
        confirmed: true,
        expectedFrozenAt: frozenAt,
      });
      await onChanged?.();
    } catch (caught) {
      setError({
        id,
        text:
          caught instanceof ApiError && caught.status === 409
            ? adminCopy.errors.riskUpdated
            : adminCopy.errors.unfreeze,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-security" aria-label={copy.section}>
      <header>
        <span className="eyebrow">{copy.review}</span>
        <h2>{copy.heading}</h2>
      </header>
      <div className="admin-notice">
        <strong>{copy.protected}</strong>
        <p>{copy.protection}</p>
      </div>

      <section className="paper-panel admin-panel">
        <h3>{copy.comparison}</h3>
        <p className="admin-helper">{copy.limits}</p>
        <p className="admin-helper">
          {copy.calibration} ·{" "}
          <SafeMarkdown plain inline content={review.calibration} />
        </p>
        <dl className="risk-controls">
          {controls.map(([name, value, status]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd className="admin-number">
                {value}
                <small>{status}</small>
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="paper-panel admin-panel">
        <h3>{copy.accounts}</h3>
        <div className="table-scroll">
          <table className="admin-table" aria-label={copy.accounts}>
            <thead>
              <tr>
                <th scope="col">{copy.account}</th>
                <th scope="col" className="admin-number">
                  {copy.scoreAndEvents}
                </th>
                <th scope="col" className="admin-number">
                  {copy.recentEvent}
                </th>
                <th scope="col">{copy.freezeState}</th>
              </tr>
            </thead>
            <tbody>
              {review.accounts.map((account) => (
                <tr key={account.id}>
                  <th scope="row">
                    <SafeMarkdown plain inline content={account.email} />
                  </th>
                  <td className="admin-number">
                    {number.format(account.score)} /{" "}
                    {number.format(account.events)}
                  </td>
                  <td className="admin-number">
                    {account.lastEvent ? (
                      <time dateTime={account.lastEvent}>
                        {new Date(account.lastEvent).toLocaleString("zh-CN")}
                      </time>
                    ) : (
                      copy.noEvent
                    )}
                  </td>
                  <td>
                    <span
                      className={
                        account.frozenAt ? "admin-failed-state" : undefined
                      }
                    >
                      {account.frozenAt ? copy.frozen : copy.unfrozen}
                    </span>
                    <Button
                      className="admin-table-action"
                      variant="ghost"
                      disabled={busy || !account.frozenAt}
                      onClick={() =>
                        void unfreeze(account.id, account.frozenAt)
                      }
                    >
                      {copy.unfreeze}
                    </Button>
                    {error?.id === account.id && (
                      <div className="admin-error">
                        <p role="alert">{error.text}</p>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setError(undefined);
                            void onChanged?.();
                          }}
                        >
                          {adminCopy.reload}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="paper-panel admin-panel">
        <h3>{copy.riskAudit}</h3>
        {review.riskAudit.length > 0 ? (
          <div className="table-scroll">
            <table className="admin-table" aria-label={copy.riskAudit}>
              <thead>
                <tr>
                  <th scope="col" className="admin-number">
                    {copy.time}
                  </th>
                  <th scope="col">{copy.account}</th>
                  <th scope="col">{copy.operation}</th>
                  <th scope="col" className="admin-number">
                    {copy.accumulated}
                  </th>
                  <th scope="col">{copy.actor}</th>
                </tr>
              </thead>
              <tbody>
                {review.riskAudit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="admin-number">
                      <time dateTime={entry.at}>
                        {new Date(entry.at).toLocaleString("zh-CN")}
                      </time>
                    </td>
                    <td>
                      <SafeMarkdown inline plain content={entry.userId} />
                    </td>
                    <td>
                      {entry.action === "freeze"
                        ? copy.autoFreeze
                        : copy.manualUnfreeze}
                    </td>
                    <td className="admin-number">
                      {number.format(BigInt(entry.score))}
                    </td>
                    <td>
                      <SafeMarkdown
                        inline
                        plain
                        content={entry.actorId ?? copy.system}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{copy.noRiskAudit}</p>
        )}
      </section>

      <section className="paper-panel admin-panel">
        <h3>{copy.adminAudit}</h3>
        <p className="admin-helper">{copy.auditDescription}</p>
        {review.audit.length > 0 ? (
          <div className="table-scroll">
            <table className="admin-table" aria-label={copy.adminAudit}>
              <thead>
                <tr>
                  <th scope="col" className="admin-number">
                    {copy.time}
                  </th>
                  <th scope="col">{copy.actor}</th>
                  <th scope="col">{copy.operation}</th>
                  <th scope="col">{copy.outcome}</th>
                </tr>
              </thead>
              <tbody>
                {review.audit.map((entry) => (
                  <tr key={entry.id}>
                    <td className="admin-number">
                      <time dateTime={entry.at}>
                        {new Date(entry.at).toLocaleString("zh-CN")}
                      </time>
                    </td>
                    <td>
                      <SafeMarkdown
                        plain
                        inline
                        content={entry.actorId ?? copy.signedOut}
                      />
                    </td>
                    <td>{auditAction(entry.action)}</td>
                    <td>
                      {entry.outcome === "allowed" ? copy.allowed : copy.denied}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>{copy.noAudit}</p>
        )}
      </section>
    </section>
  );
}

import { accountCopy as copy } from "../../copy/zh-CN.ts";
import { RoleTag } from "../../ui/Role.tsx";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import {
  type AccountData,
  accountActivity,
  accountText,
  bankLabel,
  formatCredits,
  timeLabel,
} from "./account-data.ts";

function Time({ value }: { value: string | undefined }) {
  const label = timeLabel(value);
  return label ? <time dateTime={value}>{label}</time> : null;
}

function Amount({ value }: { value: string | bigint | null }) {
  return value === null ? (
    <span className="account-unverified">{copy.unverified}</span>
  ) : (
    copy.points(formatCredits(value))
  );
}

function ledgerLabel(reason: string) {
  switch (reason) {
    case "signup":
      return copy.signup;
    case "payment":
      return copy.payment;
    case "reconciliation":
      return copy.reconciliation;
    default:
      return copy.adjustment;
  }
}

export function AccountUsage({ data }: { data: AccountData }) {
  const { runs, activity } = accountActivity(data);
  const titles = new Map(runs.map((run) => [run.id, run.title]));
  const review = data.reservations.filter(
    (reservation) => reservation.status === "review",
  );

  function projectTitle(id: string) {
    const title = titles.get(id);
    return title ? copy.project(accountText(title)) : copy.runFallback;
  }

  return (
    <div className="account-usage-column">
      <section className="account-panel account-usage" aria-label={copy.usage}>
        <h2>{copy.usage}</h2>
        {review.length > 0 && (
          <details className="account-review-alert">
            <summary>
              {copy.reviewPending(
                review.length,
                formatCredits(
                  review.reduce(
                    (total, row) => total + BigInt(row.remaining),
                    0n,
                  ),
                ),
              )}
            </summary>
            <ul>
              {review.map((row) => (
                <li key={row.id}>
                  <span>
                    <SafeMarkdown
                      plain
                      inline
                      content={projectTitle(row.run_id)}
                    />
                    {bankLabel(row.bank) && (
                      <small>{bankLabel(row.bank)}</small>
                    )}
                  </span>
                  <span>{copy.points(formatCredits(row.remaining))}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {activity.length > 0 && (
          <table className="account-activity">
            <thead>
              <tr>
                <th scope="col">{copy.record}</th>
                <th scope="col">{copy.credits}</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((item) => {
                if (item.type === "ledger") {
                  const { entry } = item;
                  const amount = BigInt(entry.delta_credits);
                  return (
                    <tr key={entry.id}>
                      <td>
                        <span className="account-record-title">
                          {ledgerLabel(entry.reason)}
                        </span>
                        <span className="account-record-meta">
                          <Time value={item.timestamp} />
                          {bankLabel(entry.bank) && (
                            <small>{bankLabel(entry.bank)}</small>
                          )}
                        </span>
                      </td>
                      <td className="account-amount">
                        {amount > 0n && "+"}
                        {copy.points(formatCredits(amount))}
                      </td>
                    </tr>
                  );
                }
                const { run } = item;
                return (
                  <tr key={run.id} className="account-run-row">
                    <td colSpan={2}>
                      <details>
                        <summary className="account-run-summary">
                          <span
                            className="account-disclosure"
                            aria-hidden="true"
                          />
                          <span className="account-run-title">
                            <SafeMarkdown
                              plain
                              inline
                              content={projectTitle(run.id)}
                            />
                            {timeLabel(run.timestamp) && (
                              <>
                                <span aria-hidden="true">{copy.separator}</span>
                                <Time value={run.timestamp} />
                              </>
                            )}
                          </span>
                          <span className="account-amount">
                            <Amount value={run.total} />
                          </span>
                        </summary>
                        <ul className="account-roles">
                          {run.roles.map((role) => (
                            <li key={role.id}>
                              <span>
                                <RoleTag role={role.role_id} />
                                {bankLabel(role.bank) && (
                                  <small>{bankLabel(role.bank)}</small>
                                )}
                              </span>
                              <span className="account-amount">
                                <Amount value={role.charged_credits} />
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {runs.length === 0 && <p className="account-muted">{copy.noUsage}</p>}
        <p className="account-usage-footnote">{copy.recentRecords}</p>
      </section>
      {data.reviews.length > 0 && (
        <section className="account-panel account-review-history">
          <h2>{copy.reviewHistory}</h2>
          <ul>
            {data.reviews.map((row) => (
              <li key={row.id}>
                <p>
                  <SafeMarkdown
                    plain
                    inline
                    content={projectTitle(row.run_id)}
                  />
                  {copy.separator}
                  {row.action === "release"
                    ? copy.reviewReleased
                    : copy.reviewCharged(formatCredits(row.charged_credits))}
                </p>
                <SafeMarkdown plain content={accountText(row.reason)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

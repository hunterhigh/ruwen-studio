"use client";
import { useState } from "react";
import { adminCopy as copy, roleName, statusCopy } from "../copy/zh-CN.ts";
import type { AdminRiskReview } from "../server/admin-review.ts";
import { Button } from "../ui/Button.tsx";
import { InlineNotice } from "../ui/InlineNotice.tsx";
import { RoleTag } from "../ui/Role.tsx";
import { AdminAnnotationStats } from "./AdminAnnotationStats.tsx";
import { AdminSecurity } from "./AdminSecurity.tsx";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

type AdminData = {
  users: number;
  projects: number;
  failures: {
    id: string;
    role_id: string;
    status: string;
    started_at: string;
  }[];
  release: {
    p3GatePassed: boolean;
    realChargingEnabled: boolean;
    inviteOnly: boolean;
  };
  security: AdminRiskReview;
};

export function Admin() {
  const { data, error: loadError, refresh } = useApi<AdminData>("/api/admin");
  const [code, setCode] = useState("");
  const [inviteError, setInviteError] = useState(false);
  const [creating, setCreating] = useState(false);

  async function createInvite() {
    setCreating(true);
    setInviteError(false);
    try {
      const result = await post<{ code: string }>("/api/admin/invitations");
      setCode(result.code);
    } catch {
      setInviteError(true);
    } finally {
      setCreating(false);
    }
  }

  return (
    <main className="page-content admin-page">
      <header className="page-heading">
        <div>
          <h1>{copy.overview}</h1>
          <p>
            {copy.users}{" "}
            <span className="admin-number">
              {data?.users.toLocaleString("zh-CN") ?? copy.empty}
            </span>
            {" · "}
            {copy.projects}{" "}
            <span className="admin-number">
              {data?.projects.toLocaleString("zh-CN") ?? copy.empty}
            </span>
          </p>
        </div>
      </header>
      {loadError && (
        <InlineNotice
          message={copy.errors.overview}
          actionLabel={copy.reload}
          onAction={() => void refresh()}
        />
      )}
      <AdminAnnotationStats />
      <section className="paper-panel admin-panel">
        <h2>{copy.billingReview}</h2>
        <a className="ui-btn" href="/admin/reservations">
          {copy.reviewLink}
        </a>
      </section>
      <section className="paper-panel admin-panel">
        <h2>{copy.inviteHeading}</h2>
        <p>{copy.inviteDescription}</p>
        <Button
          variant="primary"
          disabled={!data || creating}
          onClick={() => void createInvite()}
        >
          {creating ? copy.creatingInvite : copy.createInvite}
        </Button>
        {inviteError && (
          <InlineNotice
            message={copy.errors.invitation}
            actionLabel={statusCopy.dismiss}
            onAction={() => setInviteError(false)}
          />
        )}
        {code && (
          <output className="admin-invite-code">
            <SafeMarkdown plain inline content={code} />
          </output>
        )}
      </section>
      {data?.security && (
        <AdminSecurity review={data.security} onChanged={refresh} />
      )}
      <section className="paper-panel admin-panel">
        <h2>{copy.failures}</h2>
        {data &&
          (data.failures.length > 0 ? (
            <div className="table-scroll">
              <table className="admin-table" aria-label={copy.failures}>
                <thead>
                  <tr>
                    <th scope="col">{copy.roleRunId}</th>
                    <th scope="col">{copy.role}</th>
                    <th scope="col">{copy.status}</th>
                    <th scope="col" className="admin-number">
                      {copy.startedAt}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.failures.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <SafeMarkdown plain inline content={row.id} />
                      </td>
                      <td>
                        {Object.hasOwn(roleName, row.role_id) ? (
                          <RoleTag role={row.role_id} />
                        ) : (
                          <SafeMarkdown plain inline content={row.role_id} />
                        )}
                      </td>
                      <td>
                        <span className="admin-failed-state">
                          {copy.failed}
                        </span>
                      </td>
                      <td className="admin-number">
                        <time dateTime={row.started_at}>
                          {new Date(row.started_at).toLocaleString("zh-CN")}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>{copy.noFailures}</p>
          ))}
        <h3 className="admin-subheading">{copy.releaseGate}</h3>
        {data && (
          <table className="admin-table" aria-label={copy.releaseGate}>
            <thead>
              <tr>
                <th scope="col">{copy.releaseItem}</th>
                <th scope="col">{copy.status}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{copy.p3Gate}</th>
                <td>
                  {data.release.p3GatePassed ? copy.p3Passed : copy.p3Pending}
                </td>
              </tr>
              <tr>
                <th scope="row">{copy.realCharging}</th>
                <td>
                  {data.release.realChargingEnabled
                    ? copy.enabled
                    : copy.disabled}
                </td>
              </tr>
              <tr>
                <th scope="row">{copy.registration}</th>
                <td>
                  {data.release.inviteOnly
                    ? copy.inviteOnly
                    : copy.openRegistration}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

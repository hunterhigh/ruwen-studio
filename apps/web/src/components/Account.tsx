"use client";
import { useState } from "react";
import { confirmation, accountCopy as copy } from "../copy/zh-CN.ts";
import { Button } from "../ui/Button.tsx";
import { useConfirm } from "../ui/ConfirmDialog.tsx";
import { AccountUsage } from "./account/AccountUsage.tsx";
import {
  type AccountData,
  accountError,
  accountText,
} from "./account/account-data.ts";
import { BalanceCard } from "./account/BalanceCard.tsx";
import { PurchaseDialog } from "./account/PurchaseDialog.tsx";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

export function Account() {
  const confirm = useConfirm();
  const { data, error, refresh } = useApi<AccountData>("/api/account");
  const [showPurchase, setShowPurchase] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [revoking, setRevoking] = useState(false);

  async function signOutAll() {
    if (revoking || !(await confirm(confirmation.signOutAll))) return;
    setSessionError("");
    setRevoking(true);
    try {
      await post("/api/auth/revoke-sessions");
      window.location.assign("/sign-in");
    } catch (caught) {
      setSessionError(accountError(caught));
      setRevoking(false);
    }
  }

  return (
    <main className="page-content account-page">
      <header className="page-heading account-heading">
        <div>
          <h1>{copy.heading}</h1>
          {data && (
            <p>
              <SafeMarkdown
                plain
                inline
                content={accountText(data.user.email)}
              />
            </p>
          )}
        </div>
      </header>
      {error && (
        <p className="account-warning" role="alert">
          {copy.loadError}
        </p>
      )}
      {!data && !error && <output>{copy.loading}</output>}
      {data && (
        <div className="account-grid">
          <div className="account-side">
            <BalanceCard
              data={data}
              refresh={refresh}
              onPurchase={() => setShowPurchase(true)}
            />
            <section className="account-panel account-devices">
              <h2>{copy.devices}</h2>
              <p>{copy.activeBrowser}</p>
              {sessionError && (
                <p className="account-warning" role="alert">
                  <SafeMarkdown plain inline content={sessionError} />
                </p>
              )}
              <Button disabled={revoking} onClick={() => void signOutAll()}>
                {revoking ? copy.revoking : copy.signOutAll}
              </Button>
            </section>
          </div>
          <AccountUsage data={data} />
        </div>
      )}
      {data && showPurchase && (
        <PurchaseDialog
          data={data}
          refresh={refresh}
          onDismiss={() => setShowPurchase(false)}
        />
      )}
    </main>
  );
}

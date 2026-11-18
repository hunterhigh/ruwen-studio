"use client";
import { usePathname } from "next/navigation.js";
import { type ReactNode, useState } from "react";
import { frameCopy } from "../copy/zh-CN.ts";
import { useConfirm } from "../ui/ConfirmDialog.tsx";
import { post } from "./client.ts";
import { PreviewBanner } from "./PreviewBanner.tsx";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
export function Shell({
  children,
  user,
  admin,
  previewBanner,
}: {
  children: ReactNode;
  user: { name: string; email: string };
  admin: boolean;
  previewBanner: boolean;
}) {
  const pathname = usePathname();
  const confirm = useConfirm();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <PreviewBanner enabled={previewBanner} />
      <div className="studio-shell">
        <aside className="sidebar">
          <a className="wordmark" href="/projects">
            {frameCopy.wordmark}
          </a>
          <p className="sidebar-caption">{frameCopy.caption}</p>
          <nav aria-label={frameCopy.navigation}>
            <a
              href="/projects"
              aria-current={
                pathname.startsWith("/projects") ? "page" : undefined
              }
            >
              {frameCopy.shelf}
            </a>
            <a
              href="/account"
              aria-current={
                pathname.startsWith("/account") ? "page" : undefined
              }
            >
              {frameCopy.account}
            </a>
            {admin && (
              <a
                href="/admin"
                aria-current={
                  pathname.startsWith("/admin") ? "page" : undefined
                }
              >
                {frameCopy.admin}
              </a>
            )}
          </nav>
          <div className="sidebar-bottom">
            <strong>
              <SafeMarkdown plain inline content={user.name || user.email} />
            </strong>
            <SafeMarkdown plain inline content={user.email} />
            <button
              type="button"
              className="sidebar-signout"
              disabled={signingOut}
              onClick={async () => {
                if (!(await confirm(frameCopy.signOutConfirmation))) return;
                setSigningOut(true);
                setError("");
                try {
                  await post("/api/auth/sign-out");
                  window.location.assign("/sign-in");
                } catch {
                  setError(frameCopy.signOutError);
                  setSigningOut(false);
                }
              }}
            >
              {signingOut ? frameCopy.signingOut : frameCopy.signOut}
            </button>
            {error && <p role="alert">{error}</p>}
          </div>
        </aside>
        <div className="studio-main">{children}</div>
      </div>
    </>
  );
}

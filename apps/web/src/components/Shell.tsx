"use client";
import type { ReactNode } from "react";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
export function Shell({
  children,
  user,
  admin,
}: {
  children: ReactNode;
  user: { name: string; email: string };
  admin: boolean;
}) {
  return (
    <div className="studio-shell">
      <aside className="sidebar">
        <a className="wordmark" href="/projects">
          如文<span>STUDIO</span>
        </a>
        <p className="sidebar-caption">你的故事工作室</p>
        <nav aria-label="主导航">
          <a href="/projects">
            项目书架<span>↗</span>
          </a>
          <a href="/account">账户与用量</a>
          {admin && <a href="/admin">管理工作室</a>}
        </nav>
        <div className="sidebar-bottom">
          <span className="preview-label">开发预览 · 待 P3 实测</span>
          <SafeMarkdown plain inline content={user.name || user.email} />
          <button
            type="button"
            className="sidebar-signout"
            onClick={() => {
              void post("/api/auth/sign-out").then(() =>
                window.location.assign("/sign-in"),
              );
            }}
          >
            退出登录
          </button>
        </div>
      </aside>
      <div className="studio-main">{children}</div>
    </div>
  );
}

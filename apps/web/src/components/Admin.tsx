"use client";
import { useState } from "react";
import type { AdminRiskReview } from "../server/admin-review.ts";
import { AdminSecurity } from "./AdminSecurity.tsx";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";
export function Admin() {
  const {
      data,
      error: loadError,
      refresh,
    } = useApi<{
      users: number;
      projects: number;
      failures: unknown[];
      release: unknown;
      security: AdminRiskReview;
    }>("/api/admin"),
    [code, setCode] = useState(""),
    [error, setError] = useState("");
  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">工作室管理</span>
          <h1>运行概况</h1>
          <p>
            用户 {data?.users ?? "…"} · 项目 {data?.projects ?? "…"}
          </p>
        </div>
      </header>
      {(error || loadError) && (
        <div role="alert" className="error">
          <SafeMarkdown plain content={error || loadError} />
        </div>
      )}
      <section className="paper-panel">
        <h2>邀请新用户</h2>
        <p>每个邀请码仅可使用一次。公开注册与真实收费受服务端闸门保护。</p>
        <button
          type="button"
          disabled={!data}
          className="button primary"
          onClick={() => {
            void post<{ code: string }>("/api/admin/invitations")
              .then((result) => setCode(result.code))
              .catch((error: Error) => setError(error.message));
          }}
        >
          生成一次性邀请码
        </button>
        {code && <SafeMarkdown plain content={code} />}
      </section>
      {data?.security && (
        <AdminSecurity review={data.security} onChanged={refresh} />
      )}
      <section className="paper-panel">
        <h2>失败任务</h2>
        <SafeMarkdown
          plain
          content={JSON.stringify(data?.failures ?? [], null, 2)}
        />
        <h3>上线闸门</h3>
        <SafeMarkdown
          plain
          content={JSON.stringify(data?.release ?? {}, null, 2)}
        />
      </section>
    </main>
  );
}

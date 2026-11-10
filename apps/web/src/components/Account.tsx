"use client";
import { useState } from "react";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";
export function Account() {
  const [sessionError, setSessionError] = useState(""),
    [revoking, setRevoking] = useState(false);
  const { data, error } = useApi<{
    user: { email: string };
    balance: string;
    usage: {
      id: string;
      role_id: string;
      model: string;
      cost_usd: string;
      mode: string;
      usage: unknown;
      title: string;
    }[];
    calibration: { label: string };
  }>("/api/account");
  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">账户 / USAGE</span>
          <h1>每次写作，都有记录。</h1>
          <p>
            <SafeMarkdown
              plain
              inline
              content={data?.user.email ?? "正在读取账户…"}
            />
          </p>
        </div>
      </header>
      {(error || sessionError) && (
        <div role="alert" className="error">
          <SafeMarkdown plain content={error || sessionError} />
        </div>
      )}
      <section className="account-note">
        <h2>当前余额 {data?.balance ?? "…"} 点</h2>
        <p>
          开发预览不收取真实费用。模型、点数和价格均待 P3
          实测及人类确认；购买与订阅将在计费阶段接入。
        </p>
        <button type="button" className="button secondary" disabled>
          充值尚未开放
        </button>
      </section>
      <section className="paper-panel">
        <h2>账户安全</h2>
        <p>
          登出所有设备会撤销当前账户的全部会话，包括此浏览器。再次进入工作室时需要重新登录。
        </p>
        <button
          type="button"
          className="button secondary"
          disabled={revoking || !data}
          onClick={() => {
            if (!window.confirm("确认登出所有设备，包括当前浏览器？")) return;
            setRevoking(true);
            void post("/api/auth/revoke-sessions")
              .then(() => window.location.assign("/sign-in"))
              .catch((error: Error) => {
                setSessionError(error.message);
                setRevoking(false);
              });
          }}
        >
          {revoking ? "正在撤销会话…" : "登出所有设备"}
        </button>
      </section>
      <h2 className="section-title">岗位用量明细</h2>
      <div className="table-scroll">
        <table className="usage-table">
          <thead>
            <tr>
              <th>项目 / 岗位</th>
              <th>模型</th>
              <th>模式</th>
              <th>记录成本（USD）</th>
              <th>用量</th>
            </tr>
          </thead>
          <tbody>
            {data?.usage.map((row) => (
              <tr key={row.id}>
                <td>
                  <SafeMarkdown plain inline content={row.title} />
                  <small>
                    <SafeMarkdown plain inline content={row.role_id} />
                  </small>
                </td>
                <td>
                  <SafeMarkdown plain inline content={row.model} />
                </td>
                <td>
                  <SafeMarkdown plain inline content={row.mode ?? "历史记录"} />
                </td>
                <td>${Number(row.cost_usd).toFixed(6)}</td>
                <td>
                  <details>
                    <summary>Token / 缓存</summary>
                    <SafeMarkdown
                      plain
                      content={JSON.stringify(row.usage, null, 2)}
                    />
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data?.usage.length === 0 && (
        <p className="muted">
          还没有岗位用量。完成一次章节流程后可在这里查看。
        </p>
      )}
      <p className="fine-print">
        faux 为模拟用量；replay 为历史用量回放，均不代表新增真实费用。待 P3
        实测。
      </p>
    </main>
  );
}

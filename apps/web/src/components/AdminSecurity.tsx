"use client";
import { useState } from "react";
import type { AdminRiskReview } from "../server/admin-review.ts";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
export function AdminSecurity({
  review,
  onChanged,
}: {
  review: AdminRiskReview;
  onChanged?: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const limits = review.designLimits;
  const controls = [
    [
      "风险冻结阈值",
      `${review.enforcedLimits.freezeScore ?? "尚未配置"} 分`,
      "已执行 · 待 P3 校准",
    ],
    ["每用户同时运行章节", `${limits.userChapterConcurrency} 个`, "待后端"],
    ["每项目同时运行", `${limits.projectConcurrency} 个`, "已有项目锁"],
    [
      "协调员单条消息",
      `${limits.coordinatorMessageChars} 字符`,
      "已有输入上限",
    ],
    ["协调员每会话每小时", `${limits.coordinatorTurnsPerHour} 轮`, "待后端"],
    ["每日点数消耗", `套餐点数的 ${limits.dailyPlanPercent}%`, "待计费后端"],
    [
      "试用点数目标",
      `${limits.trialChapterRange.join("～")} 章`,
      "待 P3 成本校准",
    ],
  ];
  return (
    <section className="admin-security" aria-label="安全与风险复核">
      <header>
        <span className="eyebrow">安全复核 / S1-4</span>
        <h2>先看事实，再做处理。</h2>
      </header>
      <div className="notice">
        <strong>运行保护已接入</strong>
        <p>
          安全事件累计达到阈值会冻结后续运行。人工复核并解冻后，保留原事件和审计；后续新事件仍会累计。
        </p>
      </div>
      {error && (
        <div className="error" role="alert">
          <SafeMarkdown plain content={error} />
        </div>
      )}
      <section className="paper-panel">
        <h3>风控配置对照</h3>
        <p className="fine-print">
          设计占位值 ·{" "}
          <SafeMarkdown plain inline content={review.calibration} />
          。除标明已有的控制外，其余尚未在后端执行；不代表当前账户限额。
        </p>
        <dl className="risk-controls">
          {controls.map(([name, value, status]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>
                {value}
                <small>{status}</small>
              </dd>
            </div>
          ))}
        </dl>
        <p className="fine-print">
          冻结阈值由服务端配置，当前试用点数已入账。一次性邮箱黑名单、会话频率与用户自行调整日上限尚未接入，不把设计配置当作已执行。
        </p>
      </section>
      <section className="paper-panel">
        <h3>账户风险事实（最多100条）</h3>
        <div className="table-scroll">
          <table className="usage-table">
            <thead>
              <tr>
                <th>账户</th>
                <th>风险分 / 事件数</th>
                <th>最近事件</th>
                <th>冻结状态</th>
              </tr>
            </thead>
            <tbody>
              {review.accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <SafeMarkdown plain inline content={account.email} />
                  </td>
                  <td>
                    {account.score} / {account.events}
                  </td>
                  <td>
                    {account.lastEvent
                      ? new Date(account.lastEvent).toLocaleString("zh-CN")
                      : "暂无事件"}
                  </td>
                  <td>
                    {account.frozenAt ? "已冻结 · 等待人工复核" : "未冻结"}
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy || !account.frozenAt}
                      onClick={() => {
                        if (
                          !account.frozenAt ||
                          !window.confirm(
                            "确认已完成人工复核并解除冻结？历史风险事件与审计会保留。",
                          )
                        )
                          return;
                        setBusy(true);
                        setError("");
                        void post(
                          `/api/admin/accounts/${account.id}/unfreeze`,
                          {
                            confirmed: true,
                            expectedFrozenAt: account.frozenAt,
                          },
                        )
                          .then(() => onChanged?.())
                          .catch((caught: Error) => setError(caught.message))
                          .finally(() => setBusy(false));
                      }}
                    >
                      人工复核并解冻
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="paper-panel">
        <h3>冻结与解冻审计</h3>
        {review.riskAudit.map((entry) => (
          <p key={entry.id}>
            {new Date(entry.at).toLocaleString("zh-CN")} ·{" "}
            <SafeMarkdown inline plain content={entry.userId} /> ·{" "}
            {entry.action === "freeze" ? "自动冻结" : "人工解冻"} · 累计{" "}
            {entry.score} 分 ·{" "}
            <SafeMarkdown inline plain content={entry.actorId ?? "系统"} />
          </p>
        ))}
      </section>
      <section className="paper-panel">
        <h3>管理访问审计（最近100条）</h3>
        <p className="fine-print">
          页面、数据读取和邀请码操作均留痕；记录不含稿件、提示词、会话令牌或邀请码原文。当前管理页不提供稿件或完整转录读取。
        </p>
        <div className="table-scroll">
          <table className="usage-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>操作</th>
                <th>授权结果</th>
              </tr>
            </thead>
            <tbody>
              {review.audit.map((entry) => (
                <tr key={entry.id}>
                  <td>{new Date(entry.at).toLocaleString("zh-CN")}</td>
                  <td>
                    <SafeMarkdown
                      plain
                      inline
                      content={entry.actorId ?? "未登录"}
                    />
                  </td>
                  <td>
                    <SafeMarkdown plain inline content={entry.action} />
                  </td>
                  <td>{entry.outcome === "allowed" ? "允许" : "拒绝"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {review.audit.length === 0 && <p>暂无管理访问记录。</p>}
      </section>
    </section>
  );
}

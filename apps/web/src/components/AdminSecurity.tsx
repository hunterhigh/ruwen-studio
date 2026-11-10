"use client";
import type { AdminRiskReview } from "../server/admin-review.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
export function AdminSecurity({ review }: { review: AdminRiskReview }) {
  const limits = review.designLimits;
  const controls = [
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
        <strong>冻结执行服务尚未接入</strong>
        <p>
          风险分来自现有安全事件。当前只能查看，无法判断账户是否已冻结，也不能执行冻结或解除冻结。
        </p>
        <button type="button" className="button secondary" disabled>
          冻结运行（待后端接入）
        </button>{" "}
        <button type="button" className="button secondary" disabled>
          解除冻结（待后端接入）
        </button>
      </div>
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
          冻结阈值、一次性邮箱黑名单、试用点数与用户自行调整日上限：等待后端契约接入。此页不作自动封禁决定。
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
                  <td>未知 · 冻结服务未接入</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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

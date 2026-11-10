"use client";
import { useState } from "react";
import type { billingAccount } from "../server/billing-account.ts";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

type AccountData = Awaited<ReturnType<typeof billingAccount>> & {
  user: { email: string };
};
export function Account() {
  const [sessionError, setSessionError] = useState(""),
    [revoking, setRevoking] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const { data, error, refresh } = useApi<AccountData>("/api/account");
  async function pay(callback: () => Promise<unknown>) {
    setBusy(true);
    setSessionError("");
    setNotice("");
    try {
      await callback();
      await refresh();
    } catch (caught) {
      setSessionError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
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
        <div className="error" role="alert">
          <SafeMarkdown plain content={error || sessionError} />
        </div>
      )}
      {notice && <output className="notice">{notice}</output>}
      {data?.frozenAt && (
        <div className="error" role="alert">
          账户运行已冻结，等待人工复核。已有内容仍可阅读。
        </div>
      )}
      <section className="account-note">
        <h2>余额与预留</h2>
        <p>
          点数、价格及预留均待 P3
          实测。沙箱点数只用于模拟或回放，不能支付真实模型运行；真实收费默认关闭。
        </p>
        <div className="billing-balances">
          {(["live", "sandbox"] as const).map((bank) => (
            <article key={bank}>
              <h3>
                {bank === "live" ? "正式点数" : "沙箱点数"}
                {data?.bank === bank ? " · 当前运行" : ""}
              </h3>
              <strong>
                <SafeMarkdown
                  inline
                  plain
                  content={data?.banks[bank].balance ?? "…"}
                />{" "}
                点
              </strong>
              <p>
                预留{" "}
                <SafeMarkdown
                  inline
                  plain
                  content={data?.banks[bank].reserved ?? "…"}
                />{" "}
                · 可用{" "}
                <SafeMarkdown
                  inline
                  plain
                  content={data?.banks[bank].available ?? "…"}
                />
              </p>
            </article>
          ))}
        </div>
      </section>
      <section className="paper-panel">
        <h2>购买测试点数</h2>
        <p>只提供沙箱结账，不收取真实款项。测试点数与正式余额分开。</p>
        {!data?.sandboxEnabled && (
          <p className="notice">测试购买尚未开放，真实收费保持关闭。</p>
        )}
        <div className="billing-plans">
          {data?.plans.map((plan) => (
            <article key={plan.id}>
              <h3>
                <SafeMarkdown inline plain content={plan.name} />
              </h3>
              <p>
                {plan.credits.toLocaleString("zh-CN")} 沙箱点 · 测试价格 $
                {(plan.priceMinor / 100).toFixed(2)} USD
              </p>
              <small>待 P3 实测</small>
              <button
                type="button"
                className="button secondary"
                disabled={busy || !data.sandboxEnabled || !!data.frozenAt}
                onClick={() => {
                  void pay(async () => {
                    await post("/api/billing/checkout", {
                      planId: plan.id,
                      clientRequestId: crypto.randomUUID(),
                    });
                    setNotice(
                      "测试结账已创建，尚未增加点数。请在下方确认模拟支付或打开测试结账。",
                    );
                  });
                }}
              >
                购买测试点数 · <SafeMarkdown inline plain content={plan.name} />
              </button>
            </article>
          ))}
        </div>
        {data?.checkouts.map((checkout) => (
          <div className="billing-checkout" key={checkout.id}>
            <p>
              <SafeMarkdown
                inline
                plain
                content={
                  data.plans.find((plan) => plan.id === checkout.plan_id)
                    ?.name ?? "测试点数包"
                }
              />{" "}
              · {checkout.credits} 沙箱点 ·{" "}
              {checkout.status === "paid"
                ? "测试支付已完成"
                : checkout.prepared_at
                  ? "等待测试支付"
                  : "结账待核对，不自动再次创建"}
            </p>
            {checkout.status === "pending" &&
              checkout.prepared_at &&
              checkout.provider === "mock" && (
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !data.sandboxEnabled}
                  onClick={() => {
                    if (
                      window.confirm(
                        "确认完成模拟支付？不会扣真实款项，点数只进入沙箱余额。",
                      )
                    )
                      void pay(async () => {
                        await post(
                          `/api/billing/checkouts/${checkout.id}/complete`,
                        );
                        setNotice(
                          "模拟支付已记入沙箱点数账本。重复通知不会重复加点。",
                        );
                      });
                  }}
                >
                  完成模拟支付
                </button>
              )}
            {checkout.status === "pending" && checkout.external_url && (
              <SafeMarkdown
                content={`[打开 Lemon Squeezy 测试结账](${checkout.external_url})`}
              />
            )}
          </div>
        ))}
      </section>
      {!!data?.reservations.length && (
        <section className="paper-panel">
          <h2>运行预留</h2>
          {data.reservations.map((row) => (
            <p key={row.id}>
              <SafeMarkdown inline plain content={row.run_id} /> ·{" "}
              {row.bank === "sandbox" ? "沙箱" : "正式"} · 剩余 {row.remaining}{" "}
              点 ·{" "}
              {row.status === "review"
                ? "服务商结果未知，等待核对；未把费用当作零"
                : "预留中，结束或取消后释放已核实的余量"}
            </p>
          ))}
        </section>
      )}
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
              <th>扣点</th>
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
                  <SafeMarkdown
                    plain
                    inline
                    content={row.model ?? "尚未记录"}
                  />
                </td>
                <td>
                  <SafeMarkdown plain inline content={row.mode ?? "历史记录"} />
                </td>
                <td>
                  {row.cost_usd === null || row.usage_unknown
                    ? "费用待核对"
                    : `$${Number(row.cost_usd).toFixed(6)}`}
                </td>
                <td>
                  {row.charged_credits === null
                    ? "尚未结算或历史运行"
                    : `${row.charged_credits} ${row.bank === "sandbox" ? "沙箱点" : "点"}`}
                </td>
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
      <h2 className="section-title">点数账本（最近100条）</h2>
      <div className="table-scroll">
        <table className="usage-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>账户</th>
              <th>变化</th>
              <th>原因</th>
            </tr>
          </thead>
          <tbody>
            {data?.ledger.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString("zh-CN")}</td>
                <td>{row.bank === "sandbox" ? "沙箱点数" : "正式点数"}</td>
                <td>
                  <SafeMarkdown inline plain content={row.delta_credits} />
                </td>
                <td>
                  <SafeMarkdown
                    inline
                    plain
                    content={
                      row.reason === "signup"
                        ? "注册赠点"
                        : row.reason === "payment"
                          ? "测试购买"
                          : row.reason === "role_usage"
                            ? "岗位用量"
                            : "点数调整"
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine-print">
        faux 与 replay
        只结算沙箱点数，不代表新增真实模型费用。历史运行不追溯扣点；真实收费保持关闭。待
        P3 实测。
      </p>
    </main>
  );
}

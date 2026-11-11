"use client";
import { useState } from "react";
import type { billingAccount } from "../server/billing-account.ts";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

type AccountData = Awaited<ReturnType<typeof billingAccount>> & {
  user: { id: string; email: string };
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
          {data?.localRealPreview
            ? "本机 DeepSeek 试用使用赠送的沙箱点数记录用量；API 实际费用由 DeepSeek 预付余额支付，此处不收款。"
            : "点数、价格及预留均待 P3 实测。沙箱点数只用于模拟或回放，不能支付真实模型运行；真实收费默认关闭。"}
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
      <section className="paper-panel" aria-label="每日点数上限">
        <h2>每日点数上限 · 待 P3 实测</h2>
        <p>
          按UTC日期重置，正式与沙箱分别计算同一上限。已用点数和未释放预留都计入额度；降低上限不会改写已发生的费用，会阻止后续新调用。
        </p>
        {data && (
          <>
            <div className="billing-balances">
              {(["live", "sandbox"] as const).map((bank) => (
                <article key={bank}>
                  <h3>
                    {bank === "live" ? "正式" : "沙箱"} ·{" "}
                    <SafeMarkdown inline plain content={data.daily[bank].day} />
                  </h3>
                  <p>
                    上限{" "}
                    <SafeMarkdown
                      inline
                      plain
                      content={data.daily[bank].limit}
                    />{" "}
                    点
                  </p>
                  <p>
                    今日已用{" "}
                    <SafeMarkdown
                      inline
                      plain
                      content={data.daily[bank].used}
                    />{" "}
                    · 未释放预留{" "}
                    <SafeMarkdown
                      inline
                      plain
                      content={data.daily[bank].held}
                    />
                  </p>
                  <p>
                    剩余可受理额度{" "}
                    <SafeMarkdown
                      inline
                      plain
                      content={data.daily[bank].remaining}
                    />
                  </p>
                </article>
              ))}
            </div>
            <form
              key={`${data.daily[data.bank].customLimit}-${data.daily[data.bank].defaultLimit}`}
              onSubmit={(event) => {
                event.preventDefault();
                const value = Number(
                  new FormData(event.currentTarget).get("limitCredits"),
                );
                void pay(async () => {
                  if (
                    !Number.isSafeInteger(value) ||
                    value < 1 ||
                    value > data.daily[data.bank].maximum
                  )
                    throw new Error("请输入范围内的整数点数。");
                  await post(
                    `/api/billing/accounts/${data.user.id}/daily-limit`,
                    { limitCredits: value },
                  );
                  setNotice("每日点数上限已保存。");
                });
              }}
            >
              <label>
                每日点数上限
                <input
                  name="limitCredits"
                  type="number"
                  min="1"
                  max={data.daily[data.bank].maximum}
                  step="1"
                  required
                  defaultValue={data.daily[data.bank].limit}
                  disabled={busy}
                />
              </label>
              <p className="fine-print">
                默认值按套餐点数的配置比例计算；无有效套餐时采用配置中的默认套餐基准。当前默认{" "}
                <SafeMarkdown
                  inline
                  plain
                  content={data.daily[data.bank].defaultLimit}
                />{" "}
                点，待 P3 实测。
              </p>
              <div className="decision-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  type="submit"
                >
                  保存每日上限
                </button>
                <button
                  className="button secondary"
                  disabled={busy || data.daily[data.bank].customLimit === null}
                  type="button"
                  onClick={() => {
                    void pay(async () => {
                      await post(
                        `/api/billing/accounts/${data.user.id}/daily-limit`,
                        { limitCredits: null },
                      );
                      setNotice("已恢复默认每日上限。");
                    });
                  }}
                >
                  恢复默认上限
                </button>
              </div>
            </form>
          </>
        )}
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
                ? `服务商结果未知，等待人工核对。预留折算约 USD ${Number(row.held_usd).toFixed(4)}，这不是已发生费用；核对后结算实际用量或释放剩余预留。`
                : "预留中，结束或取消后释放已核实的余量"}
            </p>
          ))}
        </section>
      )}
      {!!data?.reviews.length && (
        <section className="paper-panel">
          <h2>预留核对结果</h2>
          {data.reviews.map((review) => (
            <div key={review.id}>
              <p>
                <SafeMarkdown plain inline content={review.run_id} /> ·{" "}
                {review.action === "release"
                  ? "剩余预留已全额释放；保留已核实的岗位费用"
                  : `运行总实际费用 USD ${review.actual_cost_usd}，合计 ${review.charged_credits} 点`}
              </p>
              <SafeMarkdown plain content={review.reason} />
            </div>
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
                    ? data.reviews.some(
                        (review) => review.run_id === row.run_id,
                      )
                      ? "岗位用量未完整返回，运行已人工核对"
                      : "费用待核对"
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

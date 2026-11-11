"use client";
import { type FormEvent, useState } from "react";
import type { pendingReservations } from "../server/admin-review.ts";
import { post } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";
export function AdminReservations() {
  const {
    data,
    error: loadError,
    refresh,
  } = useApi<Awaited<ReturnType<typeof pendingReservations>>>(
    "/api/admin/reservations",
  );
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function resolve(
    event: FormEvent<HTMLFormElement>,
    id: string,
    remaining: string,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!window.confirm("确认已核对服务商账单？此次处理及理由会永久留痕。"))
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await post(`/api/admin/reservations/${id}/resolve`, {
        confirmed: true,
        action: form.get("action"),
        actualCostUsd: form.get("cost"),
        reason: form.get("reason"),
        expectedRemaining: remaining,
      });
      await refresh();
      setNotice("核对已完成，账本和处理理由已保存。");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">工作室管理 / 费用复核</span>
          <h1>待核对预留</h1>
          <a href="/admin">返回运行概况</a>
        </div>
      </header>
      <p className="notice">
        只处理服务商结果未知的运行。填写运行总实际费用时须包含已结算岗位；系统追加差额记录，不改写旧账。全额释放仅释放尚未结算的剩余预留。
      </p>
      {(error || loadError) && (
        <div className="error" role="alert">
          <SafeMarkdown plain content={error || loadError} />
        </div>
      )}
      {notice && <output>{notice}</output>}
      {data?.length === 0 && (
        <section className="paper-panel">
          <h2>暂无待核对预留</h2>
        </section>
      )}
      {data?.map((row) => (
        <section className="paper-panel" key={row.id}>
          <h2>
            <SafeMarkdown plain inline content={row.email} />
          </h2>
          <p>
            <SafeMarkdown plain inline content={row.run_id} /> ·{" "}
            {row.bank === "sandbox" ? "沙箱" : "正式"} · 保留 {row.remaining}{" "}
            点（预留折算 USD {Number(row.held_usd).toFixed(4)}，不是已发生费用）
          </p>
          <form
            onSubmit={(event) => void resolve(event, row.id, row.remaining)}
          >
            <label>
              处理方式
              <select name="action" required disabled={busy}>
                <option value="settle">按运行总实际费用结算</option>
                <option value="release">全额释放剩余预留</option>
              </select>
            </label>
            <label>
              运行总实际费用 USD
              <input
                name="cost"
                type="text"
                inputMode="decimal"
                placeholder="例如 0.125（含已结算用量）"
                disabled={busy}
              />
            </label>
            <label>
              核对理由（必填，对用户可见）
              <textarea
                name="reason"
                required
                maxLength={2000}
                disabled={busy}
              />
            </label>
            <button className="button primary" type="submit" disabled={busy}>
              确认核对并记入审计
            </button>
          </form>
        </section>
      ))}
    </main>
  );
}

"use client";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { runDetail } from "../server/api.ts";
import { post } from "./client.ts";
import { ProjectNav } from "./ProjectHome.tsx";
import {
  applyRoleFrame,
  emptyRoleStreams,
  roleStreamText,
} from "./role-streams.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

type Detail = Awaited<ReturnType<typeof runDetail>>;
const ROLES = [
  ["xiaoshuo-zuozhe", "小说作者"],
  ["qinggan-duzhe", "情感读者"],
  ["wenxue-bianji", "文学编辑"],
  ["qingjie-heyanyuan", "情节核验"],
  ["xianshi-heyanyuan", "现实核验"],
  ["jiyi-weihuyuan", "记忆维护"],
] as const;
const STATUS: Record<string, string> = {
  REQUESTED: "等待写作",
  PACKET_COMPILED: "作者准备中",
  AUTHOR_DONE: "正文已完成",
  READER_DONE: "读者已反馈",
  EDITOR_DONE: "编辑已完成",
  PLOT_CHECKED: "情节已核验",
  REALITY_CHECKED: "核验已完成",
  AWAITING_CANDIDATE_APPROVAL: "等待你阅读与批准",
  CANDIDATE_APPROVED: "正文已批准，正在生成记忆预览",
  AWAITING_MEMORY_APPROVAL: "等待批准资料变更",
  DONE: "正文与资料已提交",
  RETURNED: "已退回，等待重新构思",
  CANCELLED: "已放弃",
  FAILED: "运行未完成",
  FAILED_PRECONDITION: "资料尚未就绪",
};
const STOPPED = new Set([
  "DONE",
  "RETURNED",
  "CANCELLED",
  "FAILED",
  "FAILED_PRECONDITION",
]);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};
function TextRecord({ value }: { value: unknown }) {
  return (
    <SafeMarkdown
      plain
      content={
        typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)
      }
    />
  );
}
export function ChapterStudio({
  projectId,
  initialRun,
}: {
  projectId: string;
  initialRun?: string;
}) {
  const runs = useApi<{ id: string; chapter: string; status: string }[]>(
      `/api/projects/${projectId}/runs`,
    ),
    settings = useApi<{
      mode: string;
      calibration: { label: string };
      scenarios: string[];
    }>("/api/settings");
  const [selected, setSelected] = useState(initialRun ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!selected && runs.data?.[0]) setSelected(runs.data[0].id);
  }, [runs.data, selected]);
  const onRunChanged = useCallback(() => {
    void runs.refresh();
  }, [runs.refresh]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const result = await post<{ id: string }>(
        `/api/projects/${projectId}/chapters`,
        {
          chapter: values.get("chapter"),
          ...(settings.data?.scenarios.length
            ? { simulation: values.get("simulation") }
            : {}),
        },
      );
      setSelected(result.id);
      history.replaceState(null, "", `?run=${result.id}`);
      await runs.refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="chapter-page">
      <header className="compact-heading">
        <div>
          <span className="eyebrow">正文工作台 / CHAPTERS</span>
          <h1>一章一章，写下去。</h1>
        </div>
        <span className="mode-label">
          <SafeMarkdown plain inline content={settings.data?.mode ?? "…"} /> ·
          待 P3 实测
        </span>
      </header>
      <ProjectNav id={projectId} current="/chapters" />
      <div className="chapter-toolbar">
        <form onSubmit={create}>
          <label>
            章节
            <input
              aria-label="章节号"
              name="chapter"
              type="number"
              min="1"
              max="9999"
              defaultValue="1"
              required
            />
          </label>
          {Boolean(settings.data?.scenarios.length) && (
            <label>
              预览场景
              <select name="simulation" aria-label="预览场景">
                {settings.data?.scenarios.map((scene) => (
                  <option key={scene} value={scene}>
                    {scene}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="submit"
            className="button primary"
            disabled={busy || !settings.data}
          >
            {busy ? "正在安排…" : "开始写作"}
          </button>
        </form>
        <label className="history-selector">
          运行记录
          <select
            aria-label="运行记录"
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
              history.replaceState(null, "", `?run=${event.target.value}`);
            }}
          >
            <option value="">选择一次运行</option>
            {runs.data?.map((run, i) => (
              <option key={run.id} value={run.id}>
                第 {run.chapter} 章 · {STATUS[run.status] ?? run.status} ·{" "}
                {(runs.data?.length ?? 0) - i}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(error || runs.error) && (
        <div className="error" role="alert">
          <SafeMarkdown plain content={error || runs.error} />
        </div>
      )}
      {selected ? (
        <RunReader
          key={selected}
          id={selected}
          projectId={projectId}
          onChanged={onRunChanged}
        />
      ) : (
        <div className="empty-state">
          <span className="empty-mark">章</span>
          <h2>下一章，从这里开始</h2>
          <p>
            确认章节情境已就绪后，点击“开始写作”。候选稿将等待你的阅读与批准。
          </p>
        </div>
      )}
    </main>
  );
}
function RunReader({
  id,
  projectId,
  onChanged,
}: {
  id: string;
  projectId: string;
  onChanged: () => void;
}) {
  const { data, error: loadError, refresh } = useApi<Detail>(`/api/runs/${id}`),
    [streams, setStreams] = useState(emptyRoleStreams),
    [connected, setConnected] = useState(false),
    [tab, setTab] = useState("reader"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmedDigest, setConfirmedDigest] = useState(""),
    [reason, setReason] = useState(""),
    [returning, setReturning] = useState(false);
  const status = data?.run.status ?? "REQUESTED";
  useEffect(() => {
    const events = new EventSource(`/api/runs/${id}/events`);
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    const consume = (type: "delta" | "reset", event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data) as { role: string; text?: string };
        if (ROLES.some(([role]) => role === value.role))
          setStreams((old) =>
            applyRoleFrame(old, {
              sessionId: id,
              runId: id,
              role: value.role,
              id: event.lastEventId,
              type,
              text: value.text,
            }),
          );
      } catch {
        /* malformed event is ignored; final result is authoritative */
      }
    };
    events.addEventListener("delta", (event: MessageEvent<string>) =>
      consume("delta", event),
    );
    events.addEventListener("reset", (event: MessageEvent<string>) =>
      consume("reset", event),
    );
    events.addEventListener("status", (event: MessageEvent<string>) => {
      void refresh();
      onChanged();
      try {
        if (STOPPED.has(String(JSON.parse(event.data).status))) events.close();
      } catch {
        /* saved detail remains authoritative */
      }
    });
    return () => events.close();
  }, [id, refresh, onChanged]);
  const digest =
    status +
    (data?.run.candidateSha256 ?? "") +
    (data?.run.memoryPreviewSha256 ?? "");
  const confirmed = confirmedDigest === digest;
  const prose =
      data?.prose || roleStreamText(streams, id, id, "xiaoshuo-zuozhe"),
    paragraphs = prose.split(/\n\s*\n/),
    reading = object(data?.reports["qinggan-duzhe"]?.output),
    reactions = Array.isArray(reading.reactions)
      ? reading.reactions.map(object)
      : [],
    editor = object(data?.reports["wenxue-bianji"]?.output);
  const seenParagraphs = new Map<string, number>();
  const paragraphKeys = paragraphs.map((text) => {
    const occurrence = seenParagraphs.get(text) ?? 0;
    seenParagraphs.set(text, occurrence + 1);
    return `${text}\0${occurrence}`;
  });
  async function action(kind: string, value: Record<string, unknown> = {}) {
    setBusy(true);
    setError("");
    try {
      await post(`/api/runs/${id}/${kind}`, value);
      await refresh();
      onChanged();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const approval =
    status === "AWAITING_CANDIDATE_APPROVAL"
      ? "candidate"
      : status === "AWAITING_MEMORY_APPROVAL"
        ? "memory"
        : undefined;
  const approve = () =>
    action(`approve-${approval}`, {
      confirmed: true,
      expectedSha256:
        approval === "candidate"
          ? data?.run.candidateSha256
          : data?.run.memoryPreviewSha256,
      ...(data?.run.targetBeforeSha256
        ? { expectedTargetSha256: data.run.targetBeforeSha256 }
        : {}),
    });
  return (
    <section className="run-workspace" aria-label="章节运行">
      <div className="run-status">
        <div>
          <span className={`connection-dot ${connected ? "connected" : ""}`} />
          <strong data-testid="run-status">{STATUS[status] ?? status}</strong>
          <span className="fine-print">
            {STOPPED.has(status)
              ? "已保存"
              : connected
                ? "实时连接"
                : "连接恢复中，已保存结果可阅读"}
          </span>
        </div>
        <span className="fine-print">
          记录成本 ${Number(data?.run.costTotal ?? 0).toFixed(4)} · 待 P3 实测
        </span>
      </div>
      {(error || loadError || data?.run.error) && (
        <div role="alert" className="error">
          <SafeMarkdown
            plain
            content={error || loadError || data?.run.error || ""}
          />
        </div>
      )}
      {data?.run.returnReason && (
        <div className="notice">
          <strong>退回原因</strong>
          <SafeMarkdown content={data.run.returnReason} />
        </div>
      )}
      <ol className="role-progress" aria-label="岗位进度">
        {ROLES.map(([role, name]) => {
          const row = data?.roles.find((item) => item.role_id === role);
          return (
            <li
              key={role}
              className={
                row?.status === "completed"
                  ? "complete"
                  : row?.status === "running"
                    ? "active"
                    : ""
              }
            >
              <span>
                {row?.status === "completed"
                  ? "✓"
                  : row?.status === "running"
                    ? "●"
                    : "○"}
              </span>
              <strong>{name}</strong>
              <small>
                {row ? `$${Number(row.cost_usd ?? 0).toFixed(4)}` : "等待"}
              </small>
            </li>
          );
        })}
      </ol>
      <div className="reading-desk">
        <article className="manuscript">
          <header>
            <span className="eyebrow">
              {data?.run.candidateSha256
                ? "候选稿 · 批准前不进入正典"
                : "作者正在落笔"}
            </span>
            <h2>
              第{" "}
              <SafeMarkdown
                plain
                inline
                content={String(data?.run.chapter ?? "…")}
              />{" "}
              章
            </h2>
            <div className="manuscript-meta">
              {Array.from(prose).length} 字符 ·{" "}
              {data?.run.candidateSha256 ? "编辑稿" : "流式草稿"}
            </div>
          </header>
          {prose ? (
            paragraphs.map((paragraph, index) => (
              <div
                id={`paragraph-${index}`}
                className="prose-paragraph"
                key={paragraphKeys[index]}
              >
                <SafeMarkdown content={paragraph} />
              </div>
            ))
          ) : (
            <div className="manuscript-empty">
              <p>正文将在这里逐步出现。</p>
              <p>
                作者只看到经过编译的资料包；读者、编辑与核验岗位随后独立工作。
              </p>
            </div>
          )}
        </article>
        <aside className="reading-margin">
          <div className="margin-tabs">
            {[
              ["reader", "读者批注"],
              ["editor", "编辑记录"],
              ["checks", "核验结论"],
            ].map(([key, label]) => (
              <button
                type="button"
                className={tab === key ? "selected" : ""}
                key={key}
                onClick={() => setTab(key ?? "reader")}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "reader" && (
            <div className="annotation-list">
              <p className="margin-caption">未经大纲提示的阅读反应。</p>
              {!reactions.length && (
                <p className="muted">正文完成后，情感读者会在这里留下反应。</p>
              )}
              {reactions.map((reaction) => (
                <section
                  className="annotation"
                  key={String(reaction.anchor) + String(reaction.note)}
                >
                  <button
                    type="button"
                    className="quote-anchor"
                    onClick={() => {
                      const index = paragraphs.findIndex((p) =>
                        p.includes(String(reaction.anchor)),
                      );
                      if (index >= 0)
                        document
                          .getElementById(`paragraph-${index}`)
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                          });
                    }}
                  >
                    <SafeMarkdown
                      plain
                      inline
                      content={String(reaction.anchor ?? "")}
                    />
                  </button>
                  <SafeMarkdown content={String(reaction.note ?? "")} />
                  <span className="annotation-type">
                    <SafeMarkdown
                      plain
                      inline
                      content={String(reaction.type ?? "")}
                    />
                  </span>
                </section>
              ))}
            </div>
          )}
          {tab === "editor" && (
            <div className="annotation-list">
              <h3>编辑决定</h3>
              <TextRecord value={editor.decision ?? "等待编辑阅读"} />
              {Boolean(editor.return_reason) && (
                <TextRecord value={editor.return_reason} />
              )}
              <details>
                <summary>作者原稿（修改前保存）</summary>
                <SafeMarkdown content={data?.original ?? "尚无原稿"} />
              </details>
              <h3>事实修正</h3>
              <TextRecord value={data?.factChanges || "[]"} />
              <h3>文学修改</h3>
              <TextRecord value={data?.literaryChanges || "[]"} />
              <h3>本次问题记录</h3>
              <TextRecord value={editor.problems ?? []} />
            </div>
          )}
          {tab === "checks" && (
            <div className="annotation-list">
              {[
                ["qingjie-heyanyuan", "情节核验"],
                ["xianshi-heyanyuan", "现实核验"],
              ].map(([role, name]) => (
                <section className="verdict" key={role}>
                  <h3>{name}</h3>
                  <TextRecord
                    value={data?.reports[role ?? ""]?.output ?? "尚未核验"}
                  />
                </section>
              ))}
            </div>
          )}
        </aside>
      </div>
      {data?.memoryPreview && (
        <section className="memory-review">
          <header>
            <span className="eyebrow">正文批准之后 / MEMORY</span>
            <h2>阅读资料变更，再决定是否提交。</h2>
            <p>正文批准和资料变更批准是两个独立决定。</p>
          </header>
          {data.memoryFiles.length === 0 && (
            <p>本次记忆维护没有提出文件变更，仍需确认预览。</p>
          )}
          {data.memoryFiles.map((file) => (
            <details key={file.path} open>
              <summary>
                <SafeMarkdown plain inline content={file.path} />
              </summary>
              <div className="file-diff">
                <section>
                  <h3>当前资料</h3>
                  <SafeMarkdown plain content={file.before} />
                </section>
                <section>
                  <h3>提交后预览</h3>
                  <SafeMarkdown plain content={file.after} />
                </section>
              </div>
            </details>
          ))}
          <details>
            <summary>完整变更预览记录</summary>
            <SafeMarkdown plain content={data.memoryPreview} />
          </details>
        </section>
      )}
      {approval && (
        <div className="approval-bar">
          <div>
            <strong>
              {approval === "candidate"
                ? "把这份候选稿确认为正文？"
                : "提交这份资料变更？"}
            </strong>
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) =>
                  setConfirmedDigest(event.target.checked ? digest : "")
                }
              />
              {approval === "candidate"
                ? "我已阅读候选稿和核验结果，确认批准正文"
                : "我已逐项阅读资料变更预览，确认提交"}
            </label>
          </div>
          <button
            className="button primary"
            type="button"
            disabled={!confirmed || busy}
            onClick={() => {
              void approve();
            }}
          >
            {busy
              ? "正在提交…"
              : approval === "candidate"
                ? "批准正文，生成记忆预览"
                : "批准并提交资料变更"}
          </button>
        </div>
      )}
      {!STOPPED.has(status) && (
        <div className="secondary-actions">
          {status === "AWAITING_CANDIDATE_APPROVAL" && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setReturning(!returning)}
            >
              退回候选稿
            </button>
          )}
          <button
            type="button"
            className="text-button danger"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "放弃本次运行？已经提交的文学问题记录会保留；已批准正文不会撤销。",
                )
              )
                void action("cancel");
            }}
          >
            放弃本次运行
          </button>
        </div>
      )}
      {returning && status === "AWAITING_CANDIDATE_APPROVAL" && (
        <form
          className="return-form"
          onSubmit={(event) => {
            event.preventDefault();
            void action("return", { reason });
          }}
        >
          <label>
            退回原因
            <textarea
              required
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <button className="button secondary" type="submit" disabled={busy}>
            确认退回
          </button>
        </form>
      )}
      {STOPPED.has(status) && (
        <footer className="run-footer">
          <p>
            {status === "DONE"
              ? "正文与资料已按两次批准提交。"
              : "运行已停止，不会自动重写。查看原因后再决定下一步。"}
          </p>
          <a href={`/projects/${projectId}/files`}>查看项目资料 ↗</a>
        </footer>
      )}
    </section>
  );
}

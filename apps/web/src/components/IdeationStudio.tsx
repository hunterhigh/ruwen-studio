"use client";
import type {
  IdeationApprovalReceipt,
  IdeationMessage,
  IdeationPreview,
  IdeationResult,
  IdeationSession,
  IdeationSessionId,
  IdeationTask,
} from "@ruwen/pipeline";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  errorCopy,
  type IdeationUiErrorCode,
  kindNames,
  previewStatus,
  roleNames,
  taskStatus,
} from "./ideation/copy.ts";
import {
  createIdeationDemo,
  type DemoTiming,
  newRequestId,
} from "./ideation/demo.ts";
import { demoScope, fixtureResource } from "./ideation/fixtures.ts";
import { PreviewCard, Structured } from "./ideation/PreviewCard.tsx";
import { ProjectNav } from "./ProjectHome.tsx";
import {
  applyRoleFrame,
  emptyRoleStreams,
  roleStreamText,
} from "./role-streams.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";

type View = {
  session: IdeationSession;
  messages: readonly IdeationMessage[];
  previews: readonly IdeationPreview[];
  tasks: readonly IdeationTask[];
};
class UiError extends Error {
  constructor(readonly code: IdeationUiErrorCode) {
    super(code);
  }
}
function unwrap<T>(result: IdeationResult<T>) {
  if (!result.ok) throw new UiError(result.error.code);
  return result.value;
}
export function IdeationErrorNotice({ code }: { code: IdeationUiErrorCode }) {
  return (
    <div className="error" role="alert">
      <p>{errorCopy[code]}</p>
      {code === "INSUFFICIENT_CREDITS" && (
        <a href="/account">查看账户与点数 →</a>
      )}
      {code === "UNAUTHENTICATED" && <a href="/sign-in">重新登录 →</a>}
      <small>不会自动重试或发起付款。</small>
    </div>
  );
}
export function IdeationStudio({
  projectId,
  demoTiming,
  chatLimit,
}: {
  projectId: string;
  demoTiming: DemoTiming;
  chatLimit: number;
}) {
  const [adapter] = useState(() =>
    createIdeationDemo(projectId, demoTiming, chatLimit),
  );
  const [selected, setSelected] = useState<IdeationSessionId>(
    adapter.initialSessionId,
  );
  const [sessions, setSessions] = useState(adapter.sessions);
  const [streams, setStreams] = useState(emptyRoleStreams),
    [view, setView] = useState<View>();
  const [selectedPreview, setSelectedPreview] = useState(""),
    [filter, setFilter] = useState<IdeationPreview["kind"] | "all">("all");
  const [error, setError] = useState<IdeationUiErrorCode>(),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [message, setMessage] = useState(""),
    [title, setTitle] = useState(""),
    [receipt, setReceipt] = useState<IdeationApprovalReceipt>();
  const [demoError, setDemoError] = useState<IdeationUiErrorCode>(
    "INSUFFICIENT_CREDITS",
  );
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    try {
      const [session, messages, previews, tasks, listed] = await Promise.all([
        adapter.api.getIdeationSession({ sessionId: selected }),
        adapter.api.listIdeationMessages({ sessionId: selected }),
        adapter.api.listPreviews({ sessionId: selected }),
        adapter.api.listIdeationTasks({ sessionId: selected }),
        adapter.api.listIdeationSessions({ limit: 100 }),
      ]);
      const next = {
        session: unwrap(session),
        messages: unwrap(messages).items,
        previews: unwrap(previews).items,
        tasks: unwrap(tasks).items,
      };
      if (version === sequence.current) {
        setView(next);
        setSessions([...unwrap(listed).items]);
      }
    } catch (caught) {
      if (version === sequence.current)
        setError(caught instanceof UiError ? caught.code : "INTERNAL_ERROR");
    }
  }, [adapter, selected]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    setView(undefined);
    setSelectedPreview("");
    setFilter("all");
    setReceipt(undefined);
    setError(undefined);
    setNotice("");
    setMessage("");
    void refresh();
  }, [refresh]);
  useEffect(() => {
    const unsubscribe = adapter.subscribe((event) => {
      if (event.projectId !== projectId) return;
      if ((event.type === "delta" || event.type === "reset") && event.runId) {
        setStreams((old) =>
          applyRoleFrame(old, { ...event, runId: event.runId ?? "" }),
        );
      } else {
        void refreshRef.current();
      }
    });
    return () => {
      unsubscribe();
      adapter.dispose();
      sequence.current++;
    };
  }, [adapter, projectId]);
  const previews =
    view?.previews.filter((item) => filter === "all" || item.kind === filter) ??
    [];
  const preview =
    previews.find((item) => item.id === selectedPreview) ?? previews[0];
  const closed = view?.session.status === "closed";
  async function operation(callback: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setNotice("");
    try {
      await callback();
      await refreshRef.current();
    } catch (caught) {
      setError(caught instanceof UiError ? caught.code : "INTERNAL_ERROR");
    } finally {
      setBusy(false);
    }
  }
  async function decide(
    kind: "approve" | "reject" | "revise",
    text: string,
    trialRead: boolean,
  ) {
    if (!preview || !view) return;
    const target = preview;
    await operation(async () => {
      const request = {
        clientRequestId: newRequestId(),
        previewId: target.id,
        expectedSha256: target.sha256,
      };
      if (Array.from(text).length > chatLimit)
        throw new UiError("INPUT_LIMIT_EXCEEDED");
      if (kind === "approve") {
        const result =
          target.kind === "expression_candidate" &&
          target.approvalStage === "activation"
            ? await adapter.api.activateExpression({
                ...request,
                confirmed: true,
                trialReadConfirmed: trialRead as true,
                resourceId: target.resource.id,
                expectedResourceSha256: target.resource.sha256,
              })
            : await adapter.api.approvePreview({ ...request, confirmed: true });
        setReceipt(unwrap(result));
        setNotice("模拟批准已记录。实际项目文件、正典和余额均未改变。");
      } else if (kind === "reject") {
        unwrap(
          await adapter.api.rejectPreview({
            ...request,
            ...(text ? { reason: text } : {}),
          }),
        );
        setReceipt(undefined);
        setNotice("已拒绝此演示预览。理由只留在协调员会话。");
      } else {
        unwrap(await adapter.api.revisePreview({ ...request, content: text }));
        setReceipt(undefined);
        setNotice("修改意见已交回协调员；旧版保留，新版需要重新阅读与批准。");
      }
    });
  }
  return (
    <main className="ideation-page">
      <header className="compact-heading">
        <div>
          <span className="eyebrow">故事构思 / IDEATION</span>
          <h1>把想法，交还给故事。</h1>
        </div>
        <span className="mode-label">本地演示 · 待 P3 实测</span>
      </header>
      <ProjectNav id={projectId} current="/ideation" />
      <p className="notice">
        构思界面演示 ·
        使用本地假数据，不保存对话、不提交项目资料、不扣点数。刷新后重置。
      </p>
      {error && <IdeationErrorNotice code={error} />}
      {notice && <output className="notice">{notice}</output>}
      <div className="ideation-desk">
        <aside className="ideation-sessions" aria-label="会话列表">
          <span className="eyebrow">想法的来处</span>
          <h2>构思会话</h2>
          <label className="session-select-label">
            构思会话
            <select
              aria-label="构思会话"
              value={selected}
              disabled={busy}
              onChange={(event) => {
                const value = adapter.sessions.find(
                  (row) => row.id === event.target.value,
                );
                if (value) setSelected(value.id);
              }}
            >
              {sessions.map((session, index) => (
                <option key={session.id} value={session.id}>
                  {index < 2 ? session.title : `会话 ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <ul>
            {sessions.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  disabled={busy}
                  aria-current={selected === session.id ? "true" : undefined}
                  onClick={() => setSelected(session.id)}
                >
                  <SafeMarkdown inline plain content={session.title} />
                  <small>
                    {session.status === "closed"
                      ? "已关闭 · 停止新对话"
                      : "开放"}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void operation(async () => {
                const result = unwrap(
                  await adapter.api.createIdeationSession({
                    clientRequestId: newRequestId(),
                    title,
                  }),
                );
                setTitle("");
                setSelected(result.id);
              });
            }}
          >
            <label>
              新会话名称
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={80}
                placeholder="为一个新想法留位置"
              />
            </label>
            <button
              className="button secondary"
              type="submit"
              disabled={busy || !title.trim()}
            >
              新建构思会话
            </button>
          </form>
          <p className="fine-print">
            会话中的原话留给协调员。下游只接收通过通讯门的委托。
          </p>
        </aside>
        <section className="ideation-conversation" aria-label="协调员会话">
          <header>
            <div>
              <span className="eyebrow">与你对话的岗位</span>
              <h2>创意协调员</h2>
            </div>
            {view && (
              <button
                type="button"
                className="text-button"
                disabled={busy || closed}
                onClick={() => {
                  if (
                    window.confirm(
                      "关闭此演示会话的新对话？已有任务继续，预览仍可阅读和决定。",
                    )
                  )
                    void operation(async () => {
                      unwrap(
                        await adapter.api.closeIdeationSession({
                          sessionId: view.session.id,
                          clientRequestId: newRequestId(),
                        }),
                      );
                      setNotice("演示会话已关闭，已有任务和预览仍可操作。");
                    });
                }}
              >
                关闭会话
              </button>
            )}
          </header>
          <div className="ideation-messages" aria-live="polite">
            {view?.messages.map((item) => (
              <article
                key={item.id}
                className={`ideation-message message-${item.role}`}
              >
                <span className="eyebrow">
                  {item.role === "user" ? "你" : "协调员"}
                </span>
                <SafeMarkdown content={item.content} />
              </article>
            ))}
            {view && !view.messages.length && (
              <div className="ideation-chat-empty">
                <h3>从一个放不下的念头开始</h3>
                <p>聊聊人物、冲突，或你希望读到的那种感觉。</p>
              </div>
            )}
            {view?.tasks
              .filter(
                (task) =>
                  task.stage === "coordinator" &&
                  (["QUEUED", "RUNNING"].includes(task.status) ||
                    !!roleStreamText(streams, selected, task.id, task.role)) &&
                  !view.messages.some(
                    (item) =>
                      item.role === "assistant" && item.turnId === task.id,
                  ),
              )
              .map((task) => (
                <div
                  className="ideation-message message-assistant"
                  key={task.id}
                >
                  <span className="eyebrow">
                    协调员 · {taskStatus[task.status]}
                  </span>
                  <SafeMarkdown
                    content={roleStreamText(
                      streams,
                      selected,
                      task.id,
                      task.role,
                    )}
                  />
                </div>
              ))}
          </div>
          <form
            className="ideation-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (!view) return;
              void operation(async () => {
                if (Array.from(message).length > chatLimit)
                  throw new UiError("INPUT_LIMIT_EXCEEDED");
                unwrap(
                  await adapter.api.sendIdeationMessage({
                    sessionId: view.session.id,
                    expectedSessionRevision: view.session.revision,
                    clientRequestId: newRequestId(),
                    content: message,
                  }),
                );
                setMessage("");
              });
            }}
          >
            <label>
              想和协调员说的话
              <textarea
                rows={4}
                value={message}
                disabled={closed}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  closed
                    ? "此会话已关闭，可新建会话继续。"
                    : "说说你想写什么，哪些事实不能改变。"
                }
              />
            </label>
            <div>
              <small>
                {Array.from(message).length} / {chatLimit} 字符
              </small>
              <button
                className="button primary"
                type="submit"
                disabled={
                  busy ||
                  closed ||
                  !view ||
                  !!view.session.currentTurnId ||
                  !message.trim()
                }
              >
                {view?.session.currentTurnId
                  ? "协调员正在回应…"
                  : "发送给协调员"}
              </button>
            </div>
          </form>
        </section>
        <section className="ideation-review" aria-label="构思预览工作台">
          <header>
            <span className="eyebrow">先阅读，再决定</span>
            <h2>每个决定，留给你。</h2>
            <p>理解、委托与变更分开阅读。你的决定只绑定眼前这一版。</p>
          </header>
          <label>
            预览类型
            <select
              aria-label="预览类型"
              value={filter}
              onChange={(event) => {
                const value = event.target.value;
                if (value === "all" || value in kindNames) {
                  setFilter(value as typeof filter);
                  setSelectedPreview("");
                }
              }}
            >
              <option value="all">全部预览</option>
              {Object.entries(kindNames).map(([kind, name]) => (
                <option key={kind} value={kind}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <section className="ideation-preview-list" aria-label="预览列表">
            {previews.map((item) => (
              <button
                type="button"
                key={item.id}
                className={preview?.id === item.id ? "selected" : ""}
                onClick={() => setSelectedPreview(item.id)}
              >
                <span>
                  {kindNames[item.kind]} · 版本 {item.revision} ·{" "}
                  {previewStatus[item.status]}
                  {item.kind === "expression_candidate"
                    ? item.approvalStage === "activation"
                      ? " · 激活阶段"
                      : " · 候选阶段"
                    : ""}
                </span>
                <SafeMarkdown inline plain content={item.summary} />
              </button>
            ))}
          </section>
          {preview ? (
            <PreviewCard
              key={`${preview.id}:${preview.sha256}:${closed}`}
              preview={preview}
              busy={busy}
              canRevise={!closed}
              onAction={(kind, text, trialRead) => {
                void decide(kind, text, trialRead);
              }}
            />
          ) : (
            <div className="empty-state">
              <h3>预览会在这里等待你</h3>
              <p>先与协调员对话，或切换预览类型。</p>
            </div>
          )}
          {receipt && (
            <details className="ideation-receipt">
              <summary>上次模拟批准记录（非真实提交）</summary>
              <Structured
                value={{
                  decisionId: receipt.id,
                  previewId: receipt.previewId,
                  startedTaskId: receipt.startedTaskId,
                  simulatedFiles: receipt.committedFiles,
                  simulatedProjection: receipt.projectionRegistered,
                }}
              />
            </details>
          )}
        </section>
      </div>
      <section className="ideation-tasks" aria-label="下游任务">
        <header>
          <div>
            <span className="eyebrow">委托之后</span>
            <h2>任务与用量</h2>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              if (!view) return;
              void operation(async () => {
                unwrap(
                  await adapter.api.requestIdeationCompilation({
                    sessionId: view.session.id,
                    chapter: String(form.get("chapter")),
                    scope: {
                      volume: demoScope.volume,
                      arc: demoScope.arc,
                      scene_type: demoScope.scene_type,
                      pov: demoScope.pov,
                    },
                    sources: [
                      {
                        resourceId: fixtureResource.id,
                        expectedSha256: fixtureResource.sha256,
                      },
                    ],
                    clientRequestId: newRequestId(),
                  }),
                );
                setNotice(
                  "模拟编译已安排；只提交章节、作用域和来源ID/指纹，不提交原话或情境正文。",
                );
              });
            }}
          >
            <label>
              编译章节
              <input
                name="chapter"
                type="number"
                min="1"
                max="9999"
                defaultValue="2"
                required
              />
            </label>
            <button
              className="button secondary"
              type="submit"
              disabled={busy || !view}
            >
              编译章节情境（演示）
            </button>
          </form>
        </header>
        <p className="fine-print">
          模拟任务无真实费用；未知用量保留为未记录。中断不自动重跑。编译使用演示的已批准来源。
        </p>
        <div className="ideation-task-list">
          {view?.tasks.map((task) => (
            <article key={task.id} className="ideation-task">
              <div>
                <strong>{roleNames[task.role]}</strong>
                <span className="preview-state">{taskStatus[task.status]}</span>
              </div>
              <p className="fine-print">
                输入 {task.usage.inputTokens} · 输出 {task.usage.outputTokens} ·
                cacheRead {task.usage.cacheReadTokens} · cacheWrite{" "}
                {task.usage.cacheWriteTokens} ·{" "}
                {task.usage.costUsd === null
                  ? "费用未记录"
                  : `记录成本 $${task.usage.costUsd}`}{" "}
                · 待 P3 实测
              </p>
              {task.error && <p>{errorCopy[task.error.code]}</p>}
              {task.stage !== "coordinator" && (
                <SafeMarkdown
                  content={roleStreamText(
                    streams,
                    selected,
                    task.id,
                    task.role,
                  )}
                />
              )}
              <div className="decision-actions">
                {task.outputPreviewIds.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className="text-button"
                    onClick={() => {
                      setFilter("all");
                      setSelectedPreview(id);
                      document
                        .querySelector('[aria-label="构思预览工作台"]')
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        });
                    }}
                  >
                    查看对应预览
                  </button>
                ))}
                {!["SUCCEEDED", "CANCELLED", "FAILED", "INTERRUPTED"].includes(
                  task.status,
                ) && (
                  <button
                    className="text-button danger"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          "取消此演示任务？已批准资料和已发生用量不会撤销。",
                        )
                      )
                        void operation(async () => {
                          unwrap(
                            await adapter.api.cancelIdeationTask({
                              taskId: task.id,
                              clientRequestId: newRequestId(),
                            }),
                          );
                          setNotice("演示任务已取消，没有撤销已批准资料。");
                        });
                    }}
                  >
                    取消任务
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
      <details className="ideation-demo-tools">
        <summary>流式演示场景</summary>
        <p>仅供本地界面检查，刷新会清除所有演示状态。</p>
        <button
          className="button secondary"
          type="button"
          disabled={closed}
          onClick={() => adapter.attempt(selected, false)}
        >
          演示格式更正
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={closed}
          onClick={() => adapter.attempt(selected, true)}
        >
          演示安全拒绝
        </button>
        <section aria-label="构思流式预览">
          {adapter.runs
            .filter((run) => run.sessionId === selected)
            .map((run) => (
              <article
                key={run.runId}
                data-testid="ideation-stream"
                aria-label="当前岗位尝试"
              >
                <SafeMarkdown
                  content={roleStreamText(
                    streams,
                    run.sessionId,
                    run.runId,
                    "chuangyi-xietiaoyuan",
                  )}
                />
              </article>
            ))}
        </section>
        <label>
          错误场景
          <select
            aria-label="错误场景"
            value={demoError}
            onChange={(event) =>
              setDemoError(event.target.value as IdeationUiErrorCode)
            }
          >
            {Object.keys(errorCopy).map((code) => (
              <option value={code} key={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          type="button"
          onClick={() => setError(demoError)}
        >
          查看错误提示
        </button>
      </details>
    </main>
  );
}

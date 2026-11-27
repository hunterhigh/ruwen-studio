"use client";
import type {
  IdeationApprovalReceipt,
  IdeationContextScope,
  IdeationCursor,
  IdeationMessage,
  IdeationPreviewV1_2 as IdeationPreview,
  IdeationPreviewId,
  IdeationResult,
  IdeationSession,
  IdeationSessionId,
  IdeationTask,
} from "@ruwen/pipeline";
import { useRouter } from "next/navigation.js";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ideationCopy as c,
  confirmation,
  errorCopy,
  frameCopy,
  type IdeationUiErrorCode,
  previewStatus,
  roleName,
} from "../copy/zh-CN.ts";
import { useConfirm } from "../ui/ConfirmDialog.tsx";
import { useToast } from "../ui/Toast.tsx";
import {
  allIdeationPages,
  createIdeationClient,
  newRequestId,
} from "./ideation/client.ts";
import {
  ideationTime,
  PreviewCard,
  previewKind,
} from "./ideation/PreviewCard.tsx";
import { TaskStrip } from "./ideation/TaskStrip.tsx";
import {
  VerbatimSelection,
  type VerbatimTargetOption,
} from "./ideation/VerbatimSelection.tsx";
import { useProjectDecisionContext } from "./project/ProjectDecisions.tsx";
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
type Area = "conversation" | "inbox" | "sessions" | "decision";
type Inbox = "pending" | "processed";

class UiError extends Error {
  constructor(readonly code: IdeationUiErrorCode) {
    super(code);
  }
}

function unwrap<T>(result: IdeationResult<T>) {
  if (!result.ok) throw new UiError(result.error.code);
  return result.value;
}

function writeQuery(fields: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(fields)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  window.history.replaceState(window.history.state, "", url);
}

export function IdeationErrorNotice({ code }: { code: IdeationUiErrorCode }) {
  return (
    <div className="ideation-error" role="alert">
      <p>{errorCopy[code]}</p>
      {code === "INSUFFICIENT_CREDITS" && <a href="/account">{c.account}</a>}
      {code === "UNAUTHENTICATED" && <a href="/sign-in">{c.login}</a>}
    </div>
  );
}

export function IdeationStudio({
  projectId,
  compileScope,
  compileSources,
  nextChapter,
  chatLimit,
  verbatimTargets,
}: {
  projectId: string;
  compileScope: Omit<IdeationContextScope, "project" | "chapter">;
  compileSources: readonly { id: string; path: string; sha256: string }[];
  nextChapter: number | undefined;
  chatLimit: number;
  verbatimTargets: readonly VerbatimTargetOption[];
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const { refresh: refreshDecisions } = useProjectDecisionContext();
  const [adapter] = useState(() => createIdeationClient(projectId));
  const [selected, setSelected] = useState<IdeationSessionId>();
  const [sessions, setSessions] = useState<readonly IdeationSession[]>([]);
  const [view, setView] = useState<View>();
  const [streams, setStreams] = useState(emptyRoleStreams);
  const [selectedPreview, setSelectedPreview] = useState<string | null>();
  const [scrollPreview, setScrollPreview] = useState<string>();
  const [inboxTab, setInboxTab] = useState<Inbox>("pending");
  const [compileOpen, setCompileOpen] = useState(false);
  const [error, setError] = useState<{
    area: Area;
    code: IdeationUiErrorCode;
  }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [receipt, setReceipt] = useState<IdeationApprovalReceipt>();
  const sequence = useRef(0);
  const messagesBox = useRef<HTMLDivElement>(null);
  const currentEntry = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const follow = useRef(true);

  const selectSession = useCallback(
    (id: IdeationSessionId, preservePreview = false) => {
      setSelected(id);
      const preview = preservePreview
        ? (new URL(window.location.href).searchParams.get("preview") ??
          undefined)
        : undefined;
      setSelectedPreview(preview);
      setScrollPreview(preview);
      writeQuery(
        preservePreview ? { session: id } : { session: id, preview: null },
      );
      follow.current = true;
    },
    [],
  );

  const refresh = useCallback(async () => {
    const version = ++sequence.current;
    try {
      const page = (after?: IdeationCursor) => ({
        limit: 100,
        ...(after ? { after } : {}),
      });
      const listed = unwrap(
        await allIdeationPages((after) =>
          adapter.api.listIdeationSessions(page(after)),
        ),
      );
      if (version !== sequence.current) return;
      setSessions(listed);
      if (!selected) {
        const query = new URL(window.location.href).searchParams;
        let session = listed.find((item) => item.id === query.get("session"));
        const preview = query.get("preview");
        if (!session && preview && listed.length > 1) {
          const result = await adapter.api.getPreview({
            previewId: preview as IdeationPreviewId,
          });
          if (version !== sequence.current) return;
          if (result.ok)
            session = listed.find((item) => item.id === result.value.sessionId);
        }
        const current = session ?? listed[0];
        if (current) selectSession(current.id, true);
        return;
      }
      const [session, messages, previews, tasks] = await Promise.all([
        adapter.api.getIdeationSession({ sessionId: selected }),
        allIdeationPages((after) =>
          adapter.api.listIdeationMessages({
            sessionId: selected,
            ...page(after),
          }),
        ),
        allIdeationPages((after) =>
          adapter.api.listPreviews({ sessionId: selected, ...page(after) }),
        ),
        allIdeationPages((after) =>
          adapter.api.listIdeationTasks({
            sessionId: selected,
            ...page(after),
          }),
        ),
      ]);
      if (version === sequence.current)
        setView({
          session: unwrap(session),
          messages: unwrap(messages),
          previews: unwrap(previews),
          tasks: unwrap(tasks),
        });
    } catch (caught) {
      if (version === sequence.current)
        setError({
          area: "conversation",
          code: caught instanceof UiError ? caught.code : "INTERNAL_ERROR",
        });
    }
  }, [adapter, selected, selectSession]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    setCompileOpen(
      new URL(window.location.href).searchParams.get("compile") === "1",
    );
    setInteractive(true);
  }, []);
  useEffect(() => {
    setView(undefined);
    setInboxTab("pending");
    setReceipt(undefined);
    setError(undefined);
    setMessage("");
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!selected) return;
    const unsubscribe = adapter.subscribe(selected, (event) => {
      if (event.projectId !== projectId) return;
      if ((event.type === "delta" || event.type === "reset") && event.runId) {
        setStreams((old) =>
          applyRoleFrame(old, { ...event, runId: event.runId ?? "" }),
        );
      } else {
        if (event.type === "error")
          setError({ area: "conversation", code: event.error.code });
        void refreshRef.current();
      }
    });
    return () => {
      unsubscribe();
      sequence.current++;
    };
  }, [adapter, projectId, selected]);
  useEffect(() => () => adapter.dispose(), [adapter]);
  useLayoutEffect(() => {
    const display = messagesBox.current;
    if (display && follow.current) display.scrollTop = display.scrollHeight;
  });
  useEffect(() => {
    if (creating) nameInput.current?.focus();
  }, [creating]);

  const active = view?.session.id === selected ? view : undefined;
  const closed = active?.session.status === "closed";
  const allPreviews = active?.previews ?? [];
  const chosen = allPreviews.find((item) => item.id === selectedPreview);
  const tab = chosen
    ? chosen.status === "pending"
      ? "pending"
      : "processed"
    : inboxTab;
  const pending = allPreviews.filter(({ status }) => status === "pending");
  const previews =
    tab === "pending"
      ? pending
      : allPreviews.filter(({ status }) => status !== "pending");
  const preview =
    selectedPreview === null ? undefined : (chosen ?? previews[0]);
  const expandedId = preview?.id;
  useLayoutEffect(() => {
    if (!scrollPreview || scrollPreview !== expandedId) return;
    currentEntry.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
    setScrollPreview(undefined);
  }, [expandedId, scrollPreview]);
  const newer =
    preview &&
    allPreviews.find(
      ({ supersedesPreviewId }) => supersedesPreviewId === preview.id,
    );
  const role = active?.tasks.find(
    ({ id }) => id === receipt?.startedTaskId,
  )?.role;
  const sourcePaths = useMemo(
    () =>
      new Map(
        [...compileSources, ...verbatimTargets].map(({ id, path }) => [
          id,
          path,
        ]),
      ),
    [compileSources, verbatimTargets],
  );
  const chars = Array.from(message).length;
  const responding = Boolean(active?.session.currentTurnId);
  const canSend =
    active &&
    !busy &&
    !closed &&
    !responding &&
    message.trim() &&
    chars <= chatLimit;

  function openPreview(id: IdeationPreviewId, reveal = false) {
    setError((current) => (current?.area === "decision" ? undefined : current));
    setSelectedPreview(id);
    writeQuery({ preview: id });
    if (reveal) setScrollPreview(id);
  }
  function togglePreview(id: IdeationPreviewId) {
    if (id === preview?.id) {
      changeTab(tab, null);
      return;
    }
    openPreview(id, true);
  }
  function changeTab(next: Inbox, selection?: null) {
    setInboxTab(next);
    setError((current) => (current?.area === "decision" ? undefined : current));
    setSelectedPreview(selection);
    setScrollPreview(undefined);
    writeQuery({ preview: null });
  }
  function toggleCompile(open: boolean) {
    setCompileOpen(open);
    writeQuery({ compile: open ? "1" : null });
  }
  async function operation(area: Area, callback: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await callback();
      await refreshRef.current();
    } catch (caught) {
      setError({
        area,
        code: caught instanceof UiError ? caught.code : "INTERNAL_ERROR",
      });
    } finally {
      setBusy(false);
    }
  }
  async function decide(
    kind: "approve" | "reject" | "revise",
    text: string,
    trialRead: boolean,
  ) {
    if (!preview || !active) return;
    const target = preview;
    openPreview(target.id);
    await operation("decision", async () => {
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
        toast(
          target.kind === "handoff" ? c.approvedHandoff : c.approvedPreview,
        );
        router.refresh();
      } else if (kind === "reject") {
        unwrap(
          await adapter.api.rejectPreview({
            ...request,
            ...(text ? { reason: text } : {}),
          }),
        );
        setReceipt(undefined);
        toast(c.rejected);
      } else {
        unwrap(await adapter.api.revisePreview({ ...request, content: text }));
        setReceipt(undefined);
        toast(c.revised);
      }
      refreshDecisions();
    });
  }

  function compile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!active || busy) return;
    void operation("inbox", async () => {
      unwrap(
        await adapter.api.requestIdeationCompilation({
          sessionId: active.session.id,
          chapter: String(form.get("chapter")),
          scope: {
            volume: String(form.get("volume") ?? "").trim() || null,
            arc: String(form.get("arc") ?? "").trim() || null,
            scene_type: String(form.get("scene_type") ?? "").trim() || null,
            pov: String(form.get("pov") ?? "").trim() || null,
          },
          sources: compileSources
            .filter((item) => form.getAll("source").includes(item.id))
            .map((item) => ({
              resourceId: item.id,
              expectedSha256: item.sha256,
            })) as never,
          clientRequestId: newRequestId(),
        }),
      );
      toggleCompile(false);
      toast(c.compileSent);
    });
  }

  function renderMessage(item: IdeationMessage) {
    const previewsFromTurn =
      item.role === "assistant"
        ? (active?.tasks.find(({ id }) => item.turnId === id)
            ?.outputPreviewIds ?? [])
        : [];
    return (
      <article
        key={item.id}
        className={`ideation-message message-${item.role}`}
      >
        <span className="ideation-message-role">
          {item.role === "user" ? c.you : c.coordinator}
        </span>
        {item.role === "user" ? (
          <VerbatimSelection
            message={item}
            targets={verbatimTargets}
            busy={busy}
            onChoose={(request) => {
              void operation("inbox", async () => {
                const created = unwrap(
                  await adapter.api.createVerbatimPreview({
                    ...request,
                    clientRequestId: newRequestId(),
                  }),
                );
                openPreview(created.id, true);
                toast(c.verbatimCreated);
                refreshDecisions();
              });
            }}
          />
        ) : (
          <SafeMarkdown content={item.content} />
        )}
        {previewsFromTurn.flatMap((id) => {
          const item = allPreviews.find((row) => row.id === id);
          return item
            ? [
                <button
                  key={id}
                  type="button"
                  className="ideation-preview-pointer"
                  onClick={() => openPreview(id, true)}
                >
                  {c.pointer(previewKind(item))}
                </button>,
              ]
            : [];
        })}
      </article>
    );
  }

  return (
    <main
      className="ideation-page ideation-desk"
      aria-label={frameCopy.ideation}
    >
      <aside className="ideation-sessions" aria-label={c.sessions}>
        <h2>{c.sessionHeading}</h2>
        <ul>
          {sessions.map((session) => {
            const time = ideationTime(session.updatedAt);
            return (
              <li key={session.id}>
                <button
                  type="button"
                  disabled={busy}
                  aria-current={selected === session.id ? "true" : undefined}
                  onClick={() => selectSession(session.id)}
                >
                  <SafeMarkdown inline plain content={session.title} />
                  <small>
                    {session.status === "closed" ? c.closed : c.open}
                    {time && (
                      <>
                        {" "}
                        · <time dateTime={session.updatedAt}>{time}</time>
                      </>
                    )}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="ideation-new-session">
          {error?.area === "sessions" && (
            <IdeationErrorNotice code={error.code} />
          )}
          {creating ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (busy || !title.trim()) return;
                void operation("sessions", async () => {
                  const result = unwrap(
                    await adapter.api.createIdeationSession({
                      clientRequestId: newRequestId(),
                      title,
                    }),
                  );
                  setTitle("");
                  setCreating(false);
                  selectSession(result.id);
                });
              }}
            >
              <input
                ref={nameInput}
                aria-label={c.sessionName}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={80}
                placeholder={c.sessionPlaceholder}
                disabled={busy}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setTitle("");
                    setCreating(false);
                  }
                }}
              />
            </form>
          ) : (
            <button
              className="ui-btn ui-btn-ghost"
              type="button"
              disabled={!interactive || busy}
              onClick={() => setCreating(true)}
            >
              {c.newSession}
            </button>
          )}
          <p>{c.privacy}</p>
        </div>
      </aside>

      <section className="ideation-conversation" aria-label={c.conversation}>
        {active && (
          <header>
            <h2>
              <SafeMarkdown inline plain content={active.session.title} />
            </h2>
            {!closed && (
              <button
                className="ui-btn ui-btn-ghost ideation-close"
                type="button"
                disabled={busy}
                onClick={async () => {
                  if (await confirm(c.closeConfirmation))
                    void operation("conversation", async () => {
                      unwrap(
                        await adapter.api.closeIdeationSession({
                          sessionId: active.session.id,
                          clientRequestId: newRequestId(),
                        }),
                      );
                    });
                }}
              >
                {c.close}
              </button>
            )}
          </header>
        )}
        <div
          ref={messagesBox}
          className="ideation-messages"
          aria-live="polite"
          onScroll={(event) => {
            const list = event.currentTarget;
            follow.current =
              list.scrollHeight - list.clientHeight - list.scrollTop < 80;
          }}
        >
          {!active?.messages.length && (
            <div className="ideation-chat-empty">
              <h2>{c.emptyTitle}</h2>
              <p>{c.emptyDescription}</p>
            </div>
          )}
          {active?.messages.map(renderMessage)}
          {active?.tasks
            .filter(
              (task) =>
                task.stage === "coordinator" &&
                (["QUEUED", "RUNNING"].includes(task.status) ||
                  Boolean(
                    roleStreamText(streams, selected ?? "", task.id, task.role),
                  )) &&
                !active.messages.some(
                  (item) =>
                    item.role === "assistant" && item.turnId === task.id,
                ),
            )
            .map((task) => (
              <div className="ideation-message message-assistant" key={task.id}>
                <span className="ideation-message-role">{c.coordinator}</span>
                <div data-testid="ideation-stream">
                  <SafeMarkdown
                    content={roleStreamText(
                      streams,
                      selected ?? "",
                      task.id,
                      task.role,
                    )}
                  />
                  {["QUEUED", "RUNNING"].includes(task.status) && (
                    <span className="ideation-cursor" aria-hidden="true" />
                  )}
                </div>
              </div>
            ))}
        </div>
        <TaskStrip
          key={selected}
          tasks={active?.tasks ?? []}
          busy={busy}
          onPreview={(id) => openPreview(id, true)}
          onCancel={async (task) => {
            if (await confirm(confirmation.cancelTask))
              void operation("conversation", async () => {
                unwrap(
                  await adapter.api.cancelIdeationTask({
                    taskId: task.id,
                    clientRequestId: newRequestId(),
                  }),
                );
                toast(c.cancelledTask);
              });
          }}
        />
        {error?.area === "conversation" && (
          <IdeationErrorNotice code={error.code} />
        )}
        {closed ? (
          <p className="ideation-closed">{c.closedComposer}</p>
        ) : (
          <form
            className="ideation-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (!active || !canSend) return;
              follow.current = true;
              void operation("conversation", async () => {
                unwrap(
                  await adapter.api.sendIdeationMessage({
                    sessionId: active.session.id,
                    expectedSessionRevision: active.session.revision,
                    clientRequestId: newRequestId(),
                    content: message,
                  }),
                );
                setMessage("");
              });
            }}
          >
            <textarea
              aria-label={c.composer}
              rows={3}
              value={message}
              disabled={!active}
              placeholder={c.composerPlaceholder}
              onChange={(event) => setMessage(event.target.value)}
            />
            <div>
              <small data-over={chars > chatLimit}>
                {c.inputCount(chars, chatLimit)}
              </small>
              <button
                className="ui-btn ui-btn-primary"
                type="submit"
                disabled={!canSend}
              >
                {responding ? c.responding : c.send}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="ideation-review" aria-label={c.inbox}>
        <header className="ideation-inbox-head">
          <div className="ideation-tabs">
            <button
              type="button"
              disabled={!interactive}
              aria-pressed={tab === "pending"}
              onClick={() => changeTab("pending")}
            >
              {c.pending(pending.length)}
            </button>
            <button
              type="button"
              disabled={!interactive}
              aria-pressed={tab === "processed"}
              onClick={() => changeTab("processed")}
            >
              {c.processed}
            </button>
          </div>
          <button
            className="ui-btn ui-btn-ghost"
            type="button"
            disabled={!interactive}
            aria-expanded={compileOpen}
            onClick={() => toggleCompile(!compileOpen)}
          >
            {c.compile}
          </button>
        </header>
        {error?.area === "inbox" && <IdeationErrorNotice code={error.code} />}
        {compileOpen && (
          <form className="ideation-compile" onSubmit={compile}>
            <label>
              {c.compileChapter}
              <input
                name="chapter"
                type="number"
                min="1"
                max="9999"
                defaultValue={
                  nextChapter && nextChapter <= 9999 ? nextChapter : undefined
                }
                required
              />
            </label>
            <details>
              <summary>{c.compileExtra}</summary>
              <div className="ideation-scope">
                {(
                  Object.keys(
                    c.compileFields,
                  ) as (keyof typeof c.compileFields)[]
                ).map((field) => (
                  <label key={field}>
                    {c.compileFields[field]}
                    <input
                      name={field}
                      defaultValue={compileScope[field] ?? ""}
                      maxLength={80}
                    />
                  </label>
                ))}
              </div>
              {compileSources.map((source) => (
                <label className="ideation-check" key={source.id}>
                  <input type="checkbox" name="source" value={source.id} />
                  <SafeMarkdown inline plain content={source.path} />
                </label>
              ))}
            </details>
            <p>{c.compileHelp}</p>
            <button
              className="ui-btn ui-btn-primary"
              type="submit"
              disabled={busy || !active}
            >
              {c.compileStart}
            </button>
          </form>
        )}
        <section className="ideation-preview-list" aria-label={c.previewList}>
          {previews.map((item) => {
            const time = ideationTime(item.createdAt);
            const expanded = preview?.id === item.id;
            const cardId = `ideation-preview-${item.id}`;
            return (
              <div className="ideation-preview-entry" key={item.id}>
                <button
                  ref={expanded ? currentEntry : undefined}
                  type="button"
                  aria-current={expanded ? "true" : undefined}
                  aria-expanded={expanded}
                  aria-controls={cardId}
                  data-kind={item.kind}
                  data-handled={item.status !== "pending"}
                  onClick={() => togglePreview(item.id)}
                >
                  <span>
                    {previewKind(item)}
                    {item.kind === "expression_candidate" && (
                      <>
                        {" "}
                        ·{" "}
                        {item.approvalStage === "activation"
                          ? c.activationStage
                          : c.candidateStage}
                      </>
                    )}
                    {item.status !== "pending" && (
                      <> · {previewStatus[item.status]}</>
                    )}
                  </span>
                  <strong>
                    <SafeMarkdown inline plain content={item.summary} />
                  </strong>
                  <small>
                    {c.revision(item.revision)}
                    {time ? (
                      <>
                        {" "}
                        · <time dateTime={item.createdAt}>{time}</time>
                      </>
                    ) : (
                      <> · {roleName[item.role]}</>
                    )}
                  </small>
                </button>
                <div
                  id={cardId}
                  hidden={!expanded}
                  className="ideation-card-wrap"
                >
                  {expanded && (
                    <PreviewCard
                      key={`${item.id}:${item.sha256}:${closed}`}
                      preview={item}
                      busy={busy}
                      canRevise={!closed}
                      externalSearch={
                        active?.session.capabilities.externalSearch ?? false
                      }
                      sources={sourcePaths}
                      receipt={
                        receipt?.previewId === item.id ? receipt : undefined
                      }
                      startedRole={role ? roleName[role] : undefined}
                      error={
                        error?.area === "decision" ? (
                          <IdeationErrorNotice code={error.code} />
                        ) : undefined
                      }
                      onNewer={
                        newer ? () => openPreview(newer.id, true) : undefined
                      }
                      onAction={(kind, text, trialRead) =>
                        void decide(kind, text, trialRead)
                      }
                    />
                  )}
                </div>
              </div>
            );
          })}
        </section>
        {!previews.length && (
          <p className="ideation-inbox-empty">
            {tab === "pending" ? c.emptyInbox : c.emptyProcessed}
          </p>
        )}
      </section>
    </main>
  );
}

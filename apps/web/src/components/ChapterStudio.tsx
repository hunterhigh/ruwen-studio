"use client";
import {
  type FormEvent,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { chapterCopy as c, runStatus, statusCopy } from "../copy/zh-CN.ts";
import { displayError } from "../ui/error-text.ts";
import { InlineNotice } from "../ui/InlineNotice.tsx";
import { PageSkeleton } from "../ui/Skeleton.tsx";
import { DraftLeaveContext } from "./chapter/draft-navigation.ts";
import { RunDesk } from "./chapter/RunDesk.tsx";
import { chapterRuns, type RunSummary } from "./chapter/runs.ts";
import { ApiError, post } from "./client.ts";
import { useApi } from "./useApi.ts";

export function ChapterStudio({
  projectId,
  initialRun,
  memoryView = false,
}: {
  projectId: string;
  initialRun?: string;
  memoryView?: boolean;
}) {
  const { data, error, refresh } = useApi<RunSummary[]>(
    `/api/projects/${projectId}/runs`,
  );
  const settings = useApi<{ scenarios: string[] }>("/api/settings");
  const leaveDraft = useContext(DraftLeaveContext);
  const rows = useMemo(() => chapterRuns(data ?? []), [data]);
  const [selected, setSelected] = useState(initialRun);
  const [memory, setMemory] = useState(memoryView);
  const [newRun, setNewRun] = useState<{
    number: number;
    unfinished?: string | undefined;
  }>();
  const active = rows.find((row) => row.id === selected) ?? rows[0];
  const history = rows.filter((row) => row.chapter === active?.chapter);
  const chapterHeads = rows.filter(
    (row, index) =>
      rows.findIndex((item) => item.chapter === row.chapter) === index,
  );
  const max = Math.max(
    0,
    ...rows.map((row) => Number(row.chapter)).filter(Number.isFinite),
  );
  const readOnly = Boolean(active && active.id !== history[0]?.id);
  const number =
    history.length - history.findIndex((row) => row.id === active?.id);
  const select = async (run: string) => {
    if (
      run !== active?.id &&
      leaveDraft?.current &&
      !(await leaveDraft.current())
    )
      return;
    setSelected(run);
    setMemory(false);
    window.history.replaceState(null, "", `?run=${encodeURIComponent(run)}`);
  };
  const openWriter = async (same = false) => {
    if (leaveDraft?.current && !(await leaveDraft.current())) return;
    const unfinished =
      active && history[0]?.status !== "DONE" ? active.chapter : undefined;
    setNewRun({
      number: same || unfinished ? Number(active?.chapter ?? 1) : max + 1,
      unfinished,
    });
  };
  const newButton = (
    <button
      type="button"
      className="ui-btn ui-btn-primary"
      disabled={!data || (!settings.data && !settings.error)}
      onClick={() => openWriter()}
    >
      {c.newChapter}
    </button>
  );
  const historyControls = (
    <div className="chapter-history">
      <span>{c.history}</span>
      {chapterHeads.length > 1 && (
        <select
          aria-label={c.chapterNumber}
          value={active?.chapter}
          onChange={(event) => {
            const id = chapterHeads.find(
              (row) => row.chapter === event.target.value,
            )?.id;
            if (id) select(id);
          }}
        >
          {chapterHeads.map((row) => (
            <option key={row.id} value={row.chapter}>
              {c.chapter(Number(row.chapter))}
            </option>
          ))}
        </select>
      )}
      {history.slice(0, 5).map((row, index) => (
        <button
          type="button"
          key={row.id}
          aria-pressed={row.id === active?.id}
          onClick={() => select(row.id)}
        >
          {c.attempt(history.length - index)}
          {row.status === "RETURNED" || row.status === "CANCELLED"
            ? ` · ${runStatus[row.status]}`
            : ""}
        </button>
      ))}
      {history.length > 5 && (
        <select
          aria-label={c.older}
          value={
            history.slice(5).some((row) => row.id === active?.id)
              ? active?.id
              : ""
          }
          onChange={(event) => {
            if (event.target.value) select(event.target.value);
          }}
        >
          <option value="">{c.older}</option>
          {history.slice(5).map((row, index) => (
            <option key={row.id} value={row.id}>
              {c.attempt(history.length - index - 5)} ·{" "}
              {runStatus[row.status] ?? c.unknownStatus}
            </option>
          ))}
        </select>
      )}
      {newButton}
    </div>
  );
  return (
    <main className="chapter-page chapter-redesign">
      {error && (
        <InlineNotice
          message={statusCopy.runsFailed}
          onAction={() => void refresh()}
        />
      )}
      {settings.error && data && (
        <InlineNotice
          message={statusCopy.settingsFailed}
          onAction={() => void settings.refresh()}
        />
      )}
      {active ? (
        <RunDesk
          key={active.id}
          row={active}
          projectId={projectId}
          historyControls={historyControls}
          readOnly={readOnly}
          attempt={number}
          memory={memory}
          onChanged={refresh}
          onNewAttempt={() => openWriter(true)}
        />
      ) : data ? (
        <section className="chapter-blank">
          <p>{c.page}</p>
          <h1>{c.empty}</h1>
          <p>{c.emptyGuide}</p>
          {newButton}
        </section>
      ) : !error ? (
        <PageSkeleton page={memoryView ? "memory" : "chapter"} />
      ) : null}
      {newRun && (
        <StartChapter
          projectId={projectId}
          scenarios={settings.data?.scenarios ?? []}
          initial={newRun}
          close={() => setNewRun(undefined)}
          created={async (id) => {
            await refresh();
            await select(id);
            setNewRun(undefined);
          }}
        />
      )}
    </main>
  );
}

function StartChapter({
  projectId,
  scenarios,
  initial,
  close,
  created,
}: {
  projectId: string;
  scenarios: string[];
  initial: { number: number; unfinished?: string | undefined };
  close: () => void;
  created: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const trigger = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      const result = await post<{ id: string }>(
        `/api/projects/${projectId}/chapters`,
        {
          chapter: form.get("chapter"),
          ...(scenarios.length ? { simulation: form.get("simulation") } : {}),
        },
      );
      await created(result.id);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.code ?? "INTERNAL_ERROR")
          : "INTERNAL_ERROR",
      );
      setBusy(false);
    }
  }
  return (
    <dialog
      className="ui-confirm-dialog chapter-start"
      ref={dialog}
      aria-labelledby="chapter-start-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="chapter-start-title">{c.newChapter}</h2>
        <label>
          {c.chapterNumber}
          <input
            type="number"
            name="chapter"
            required
            min={1}
            max={9999}
            defaultValue={Math.min(initial.number, 9999)}
          />
        </label>
        {initial.unfinished && (
          <p>{c.runningChapter(String(Number(initial.unfinished)))}</p>
        )}
        {scenarios.length > 0 && (
          <label>
            {c.scenario}
            <select name="simulation">
              {scenarios.map((scene) => (
                <option key={scene} value={scene}>
                  {c.scenarios[scene as keyof typeof c.scenarios] ??
                    c.unknownStatus}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <InlineNotice
            message={
              error === "FAILED_PRECONDITION"
                ? c.notReady
                : error === "INSUFFICIENT_CREDITS"
                  ? c.insufficient
                  : displayError(error)
            }
            action={
              error === "FAILED_PRECONDITION" ? (
                <a href={`/projects/${projectId}`}>{c.overview}</a>
              ) : error === "INSUFFICIENT_CREDITS" ? (
                <a href="/account">{c.account}</a>
              ) : undefined
            }
            onAction={() => setError(undefined)}
            actionLabel={statusCopy.dismiss}
          />
        )}
        <div className="ui-dialog-actions">
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            disabled={busy}
            onClick={close}
          >
            {c.close}
          </button>
          <button
            type="submit"
            className="ui-btn ui-btn-primary"
            disabled={busy}
          >
            {busy ? c.starting : c.start}
          </button>
        </div>
      </form>
    </dialog>
  );
}

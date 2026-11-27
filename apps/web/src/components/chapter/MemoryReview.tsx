"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  memoryCopy as c,
  chapterCopy,
  cleanupCopy,
  diffCopy,
  runStatus,
  runStatusTone,
} from "../../copy/zh-CN.ts";
import { InlineNotice } from "../../ui/InlineNotice.tsx";
import { SealButton } from "../../ui/SealButton.tsx";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { TextDiff } from "../diff/TextDiff.tsx";
import { diffText } from "../diff/text-diff.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { type Detail, timeOf } from "./review-data.ts";

type MemoryFile = Detail["memoryFiles"][number];
type Item =
  | { id: string; label: string; summary: string; file: MemoryFile }
  | { id: string; label: string; summary: string; content: string };

const fields = [
  "new_facts",
  "state_changes",
  "invalidated",
  "scope_changes",
] as const;

function memoryOutput(data: Detail) {
  const output = data.reports["jiyi-weihuyuan"]?.output;
  return output && typeof output === "object" && !Array.isArray(output)
    ? (output as Record<string, unknown>)
    : undefined;
}

function fileItem(file: MemoryFile): Item {
  const groupByHeading = /\.md$/i.test(file.path);
  const { counts, emptyBefore, linesAfter } = diffText(
    file.before,
    file.after,
    groupByHeading,
  );
  const parts = [
    counts.changed ? c.changed(counts.changed) : "",
    counts.added ? c.added(counts.added) : "",
    counts.removed ? c.removed(counts.removed) : "",
    counts.same ? c.unchanged(counts.same) : "",
  ].filter(Boolean);
  return {
    id: `file:${file.path}`,
    label: file.path,
    summary:
      emptyBefore && linesAfter
        ? c.fromEmpty(linesAfter)
        : parts.join("，") || diffCopy.empty,
    file,
  };
}

const initialReading = (hash: string, updated = false) => ({
  hash,
  updated,
  checked: [] as string[],
  active: undefined as string | undefined,
});

export function MemoryReview({
  data,
  chapter,
  reviewUrl,
  overviewUrl,
  readOnly,
  busy,
  error,
  onErrorAction,
  errorActionLabel,
  onApprove,
  onAbandon,
}: {
  data: Detail;
  chapter: string;
  reviewUrl: string;
  overviewUrl: string;
  readOnly: boolean;
  busy: boolean;
  error: string;
  onErrorAction: () => void;
  errorActionLabel: string;
  onApprove: () => void;
  onAbandon: () => void;
}) {
  const { run, memoryFiles } = data;
  const hash = run.memoryPreviewSha256 ?? "";
  const output = memoryOutput(data);
  const nextState =
    typeof output?.next_chapter_state === "string"
      ? output.next_chapter_state
      : "";
  const items = useMemo(() => {
    const rows = memoryFiles.map(fileItem);
    if (rows.length && nextState.trim())
      rows.push({
        id: "next-chapter",
        label: c.nextChapter,
        summary: c.stateRecord,
        content: nextState,
      });
    return rows;
  }, [memoryFiles, nextState]);
  const [reading, setReading] = useState(() => initialReading(hash));
  const activeReading =
    reading.hash === hash ? reading : initialReading(hash, true);
  if (reading !== activeReading) setReading(activeReading);
  const advance = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const active =
    items.find(({ id }) => id === activeReading.active) ?? items[0];
  const count = items.filter(({ id }) =>
    activeReading.checked.includes(id),
  ).length;
  const allRead = count === items.length;
  const pending = run.status === "AWAITING_MEMORY_APPROVAL";
  const canDecide = pending && !readOnly;
  const done = run.status === "DONE";
  const approvedAt = timeOf(run, "CANDIDATE_APPROVED");

  useEffect(() => () => clearTimeout(advance.current), []);

  function select(id: string) {
    clearTimeout(advance.current);
    setReading({ ...activeReading, active: id });
  }

  function check(id: string, checked: boolean) {
    clearTimeout(advance.current);
    const read = checked
      ? [...activeReading.checked, id]
      : activeReading.checked.filter((item) => item !== id);
    setReading({ ...activeReading, active: id, checked: read });
    if (!checked) return;
    const current = items.findIndex((item) => item.id === id);
    const next = [...items.slice(current + 1), ...items.slice(0, current)].find(
      (item) => !read.includes(item.id),
    );
    if (next)
      advance.current = setTimeout(() => {
        setReading((previous) =>
          previous.hash === hash && previous.active === id
            ? { ...previous, active: next.id }
            : previous,
        );
      }, 250);
  }

  return (
    <section
      className="chapter-workspace memory-workspace"
      aria-label={c.workspace}
    >
      <header className="chapter-heading">
        <div>
          <h1>{c.title(chapter)}</h1>
          <div className="chapter-status-row">
            <StatusBadge tone={runStatusTone[run.status]}>
              <span data-testid="run-status">{runStatus[run.status]}</span>
            </StatusBadge>
            {approvedAt && (
              <time dateTime={approvedAt}>
                {c.approvedAt(new Date(approvedAt).toLocaleString("zh-CN"))}
              </time>
            )}
            <span>{c.independent}</span>
          </div>
        </div>
        <a className="ui-btn ui-btn-ghost" href={reviewUrl}>
          {chapterCopy.backToProse}
        </a>
      </header>
      {error && (
        <InlineNotice
          message={error}
          onAction={onErrorAction}
          actionLabel={errorActionLabel}
        />
      )}
      {pending && activeReading.updated && (
        <output className="chapter-info memory-update">{c.updated}</output>
      )}
      <div className="memory-summary">
        {fields.map((field) => {
          const value = output?.[field];
          const entries = Array.isArray(value)
            ? value.filter(
                (item): item is string =>
                  typeof item === "string" && !!item.trim(),
              )
            : [];
          return (
            <section key={field}>
              <h2>{c.summary[field]}</h2>
              {entries.length ? (
                <ul>
                  {entries.map((item, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Summary values can repeat and have no IDs.
                    <li key={index}>
                      <SafeMarkdown plain inline content={item} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{c.none}</p>
              )}
            </section>
          );
        })}
      </div>
      {active ? (
        <div className="memory-review-grid">
          <aside className="memory-index" aria-label={c.index}>
            <div className="memory-progress">
              <strong>{c.progress(count, items.length)}</strong>
              <progress aria-label={c.index} max={items.length} value={count} />
            </div>
            {items.map((item) => {
              const seen = activeReading.checked.includes(item.id);
              return (
                <button
                  key={item.id}
                  className="memory-file-row"
                  type="button"
                  aria-current={item.id === active.id ? "true" : undefined}
                  onClick={() => select(item.id)}
                >
                  <strong>
                    <SafeMarkdown plain inline content={item.label} />
                  </strong>
                  <small>{item.summary}</small>
                  {canDecide && (
                    <span className="memory-read-flag" data-read={seen}>
                      {seen ? c.read : c.unread}
                    </span>
                  )}
                </button>
              );
            })}
          </aside>
          <section className="memory-document" key={active.id}>
            <header>
              <h2>
                <SafeMarkdown plain inline content={active.label} />
              </h2>
              {canDecide && (
                <label className="memory-check">
                  <input
                    type="checkbox"
                    checked={activeReading.checked.includes(active.id)}
                    disabled={busy}
                    onChange={(event) => check(active.id, event.target.checked)}
                  />
                  {c.markRead}
                </label>
              )}
            </header>
            <div className="memory-document-body">
              {"file" in active ? (
                <TextDiff
                  before={active.file.before}
                  after={active.file.after}
                  groupByHeading={/\.md$/i.test(active.file.path)}
                />
              ) : (
                <SafeMarkdown content={active.content} />
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="memory-empty">
          <p>{c.empty}</p>
          {nextState.trim() && (
            <section>
              <h2>{c.nextChapter}</h2>
              <SafeMarkdown content={nextState} />
            </section>
          )}
        </div>
      )}
      <details className="memory-technical">
        <summary>{c.technical}</summary>
        {active && "file" in active && (
          <p>
            {c.path} <SafeMarkdown plain inline content={active.file.path} />
          </p>
        )}
        <p>
          {c.hash} <code>{hash}</code>
        </p>
      </details>
      {done ? (
        <footer className="chapter-dock memory-dock">
          <div>
            <strong>{c.submitted(chapter)}</strong>
            <small>{c.committed}</small>
          </div>
          <a className="ui-btn ui-btn-primary" href={overviewUrl}>
            {c.overview}
          </a>
        </footer>
      ) : (
        canDecide && (
          <footer className="chapter-dock memory-dock">
            <div>
              <strong>
                {items.length
                  ? c.question(items.length)
                  : cleanupCopy.emptyMemoryQuestion(chapter)}
              </strong>
              <small>
                {items.length ? c.atomic : cleanupCopy.emptyMemoryHint}
              </small>
            </div>
            {items.length > 0 && (
              <ul className="chapter-read-conditions">
                <li data-read={allRead}>{c.readCondition(items.length)}</li>
              </ul>
            )}
            <div className="chapter-actions">
              <button
                type="button"
                className="ui-btn ui-btn-danger-text"
                disabled={busy}
                onClick={onAbandon}
              >
                {chapterCopy.abandon}
              </button>
              <SealButton
                disabled={busy || !hash || !allRead}
                onClick={onApprove}
              >
                {busy
                  ? chapterCopy.approving
                  : items.length
                    ? c.submit
                    : c.confirmEmpty}
              </SealButton>
            </div>
          </footer>
        )
      )}
    </section>
  );
}

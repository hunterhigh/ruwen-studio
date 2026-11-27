"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  candidateCopy as c,
  chapterCopy,
  statusCopy,
} from "../../copy/zh-CN.ts";
import { InlineNotice } from "../../ui/InlineNotice.tsx";
import { PageSkeleton } from "../../ui/Skeleton.tsx";
import { request } from "../client.ts";
import { TextDiff } from "../diff/TextDiff.tsx";
import { countTextChanges } from "../diff/text-diff.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";

function useVersionText(id: string, version: number | undefined, attempt = 0) {
  const [snapshot, setSnapshot] = useState<{
    key: string;
    text?: string;
    error?: boolean;
  }>();
  const url =
    version === undefined
      ? ""
      : `/api/runs/${id}/candidate/revisions/${version}`;
  const key = `${url}:${attempt}`;
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    void request<{ text: string }>(url, {
      csrf: true,
      signal: abort.signal,
    }).then(
      ({ text }) => {
        if (!abort.signal.aborted) setSnapshot({ key, text });
      },
      () => {
        if (!abort.signal.aborted) setSnapshot({ key, error: true });
      },
    );
    return () => abort.abort();
  }, [key, url]);
  return snapshot?.key === key ? snapshot : undefined;
}

export function CandidateVersionNote({
  id,
  label,
  previous,
  text,
}: {
  id: string;
  label: string;
  previous: number | undefined;
  text: string;
}) {
  const old = useVersionText(id, previous)?.text;
  const changes = useMemo(
    () => (old === undefined ? undefined : countTextChanges(old, text)),
    [old, text],
  );
  return (
    <p className="chapter-version-note">
      {label}
      {changes !== undefined && ` · ${c.changeCount(changes)}`}
    </p>
  );
}

export function CandidateHistory({
  id,
  version,
  label,
  previous,
  previousLabel,
  onLatest,
}: {
  id: string;
  version: number;
  label: string;
  previous: number | undefined;
  previousLabel: string | undefined;
  onLatest: () => void;
}) {
  const [compare, setCompare] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = useVersionText(id, version, attempt);
  const before = useVersionText(id, compare ? previous : undefined, attempt);
  return (
    <>
      <div className="chapter-info chapter-version-banner">
        <span>{c.viewing(label)}</span>
        <button
          className="ui-btn ui-btn-ghost"
          type="button"
          onClick={onLatest}
        >
          {c.latest}
        </button>
      </div>
      <article className="manuscript chapter-paper chapter-history-paper">
        <div className="manuscript-meta chapter-paper-meta">
          <span>
            {compare && previous !== undefined
              ? c.comparisonLabel(previousLabel ?? c.previousVersion, label)
              : label}
          </span>
          {previous !== undefined && current?.text !== undefined && (
            <button
              className="ui-btn ui-btn-ghost"
              type="button"
              aria-pressed={compare}
              onClick={() => setCompare(!compare)}
            >
              {compare ? c.hideComparison : c.compare}
            </button>
          )}
        </div>
        {current?.error || before?.error ? (
          <InlineNotice
            message={c.versionFailed}
            onAction={() => setAttempt((value) => value + 1)}
          />
        ) : current?.text === undefined ||
          (compare && before?.text === undefined) ? (
          <PageSkeleton page="text" />
        ) : compare && before?.text !== undefined ? (
          <TextDiff before={before.text} after={current.text} />
        ) : (
          <div className="chapter-version-text">
            <SafeMarkdown plain content={current.text} />
          </div>
        )}
      </article>
    </>
  );
}

export function CandidateEditor({
  text,
  disabled,
  conflict,
  error,
  onChange,
  onReload,
}: {
  text: string;
  disabled: boolean;
  conflict: boolean;
  error: string;
  onChange: (text: string) => void;
  onReload: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const fitEditor = useCallback(() => {
    const editor = field.current;
    if (!editor) return;
    editor.style.height = "auto";
    editor.style.height = `${editor.scrollHeight}px`;
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new value changes the DOM height.
  useLayoutEffect(fitEditor, [fitEditor, text]);
  useLayoutEffect(() => {
    const editor = field.current;
    if (!editor) return;
    let width = editor.clientWidth;
    const observer = new ResizeObserver(() => {
      if (editor.clientWidth === width) return;
      width = editor.clientWidth;
      fitEditor();
    });
    observer.observe(editor);
    document.fonts.addEventListener("loadingdone", fitEditor);
    return () => {
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", fitEditor);
    };
  }, [fitEditor]);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);
  return (
    <article className="manuscript chapter-paper chapter-edit-paper">
      <div className="manuscript-meta chapter-paper-meta">
        <span>{c.editor}</span>
        <span>{chapterCopy.chars(Array.from(text).length)}</span>
      </div>
      {(conflict || error) && (
        <InlineNotice
          message={conflict ? c.conflict : error}
          action={
            conflict ? (
              <button
                className="ui-btn ui-btn-ghost"
                type="button"
                disabled={disabled}
                onClick={onReload}
              >
                {c.refresh}
              </button>
            ) : (
              <button
                className="ui-btn ui-btn-ghost"
                type="button"
                onClick={() => field.current?.focus()}
              >
                {statusCopy.adjust}
              </button>
            )
          }
        />
      )}
      <textarea
        ref={field}
        className="chapter-editor"
        aria-label={c.editor}
        disabled={disabled}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    </article>
  );
}

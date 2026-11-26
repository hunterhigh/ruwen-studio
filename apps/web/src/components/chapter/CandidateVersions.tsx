"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { candidateCopy as c, chapterCopy } from "../../copy/zh-CN.ts";
import { request } from "../client.ts";
import { TextDiff } from "../diff/TextDiff.tsx";
import { countTextChanges } from "../diff/text-diff.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import type { Detail } from "./review-data.ts";

export type CandidateVersion = NonNullable<
  Detail["run"]["candidateVersions"]
>[number];

export function verificationBasisVersion(
  run: Detail["run"],
  versions: readonly CandidateVersion[],
) {
  const basis = run.verificationBasisSha256;
  const check = run.reverification;
  if (check && check.id === run.verificationRunId && check.sha256 === basis)
    return check.version;
  const matches = versions.filter((item) => item.sha256 === basis);
  return run.verificationRunId
    ? matches.length === 1
      ? matches[0]?.version
      : undefined
    : matches.find(({ source }) => source === "editor")?.version;
}

function useVersionText(id: string, version: number | undefined) {
  const [snapshot, setSnapshot] = useState<{
    url: string;
    text?: string;
    error?: boolean;
  }>();
  const url =
    version === undefined
      ? ""
      : `/api/runs/${id}/candidate/revisions/${version}`;
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    void request<{ text: string }>(url, {
      csrf: true,
      signal: abort.signal,
    }).then(
      ({ text }) => {
        if (!abort.signal.aborted) setSnapshot({ url, text });
      },
      () => {
        if (!abort.signal.aborted) setSnapshot({ url, error: true });
      },
    );
    return () => abort.abort();
  }, [url]);
  return snapshot?.url === url ? snapshot : undefined;
}

export function CandidateVersionNote({
  id,
  version,
  previous,
  text,
}: {
  id: string;
  version: number;
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
      {c.versionNumber(version)}
      {changes !== undefined && ` · ${c.changeCount(changes)}`}
    </p>
  );
}

export function CandidateHistory({
  id,
  version,
  previous,
  onLatest,
}: {
  id: string;
  version: number;
  previous: number | undefined;
  onLatest: () => void;
}) {
  const [compare, setCompare] = useState(false);
  const current = useVersionText(id, version);
  const before = useVersionText(id, compare ? previous : undefined);
  return (
    <>
      <div className="chapter-info chapter-version-banner">
        <span>{c.viewing(version)}</span>
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
              ? c.comparisonLabel(previous, version)
              : c.versionNumber(version)}
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
          <p role="alert">{c.versionFailed}</p>
        ) : current?.text === undefined ||
          (compare && before?.text === undefined) ? (
          <output>{c.versionLoading}</output>
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
        <div className="chapter-problem chapter-version-banner" role="alert">
          <span>{conflict ? c.conflict : error}</span>
          {conflict && (
            <button
              className="ui-btn ui-btn-ghost"
              type="button"
              disabled={disabled}
              onClick={onReload}
            >
              {c.refresh}
            </button>
          )}
        </div>
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

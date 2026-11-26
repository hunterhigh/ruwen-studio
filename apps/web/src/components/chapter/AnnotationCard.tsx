"use client";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { annotationCopy as c, candidateCopy as v } from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import {
  type AnnotationFilter,
  type AnnotationView,
  annotationCounts,
} from "./review-annotations.ts";
import type { AnnotationReview } from "./useAnnotationReview.ts";

export function AnnotationHeader({
  notes,
  review,
}: {
  notes: readonly AnnotationView[];
  review: AnnotationReview;
}) {
  const { processed, total } = annotationCounts(notes);
  const bar = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (bar.current)
      bar.current.style.width = `${total ? (processed / total) * 100 : 0}%`;
  }, [processed, total]);
  return (
    <div className="chapter-annotation-header">
      <strong aria-live="polite">{c.count(total, processed)}</strong>
      <div className="chapter-annotation-progress" aria-hidden="true">
        <span ref={bar} />
      </div>
      <fieldset
        className="chapter-segment chapter-annotation-filters"
        aria-label={c.filter}
      >
        {(Object.entries(c.filters) as [AnnotationFilter, string][]).map(
          ([filter, label]) => (
            <button
              type="button"
              key={filter}
              aria-pressed={review.filter === filter}
              onClick={() => review.setFilter(filter)}
            >
              {label}
            </button>
          ),
        )}
      </fieldset>
    </div>
  );
}

export function AnnotationCard({
  note,
  label,
  summary,
  review,
  canEdit,
  onToggle,
  onEdit,
  children,
}: {
  note: AnnotationView;
  label: string;
  summary: string;
  review: AnnotationReview;
  canEdit?: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  children?: ReactNode;
}) {
  const active = review.active === note.id;
  const collapsed = note.status !== "open" && !active;
  const edited = note.kind === "editor";
  const reverted = edited && note.status === "dismissed";
  const status =
    note.status === "accepted"
      ? c.accepted
      : note.status === "dismissed"
        ? edited
          ? c.reverted
          : c.ignored
        : "";
  const action = edited ? c.revert : c.ignore;
  const failure =
    review.failure?.id === note.id ? review.failure.kind : undefined;
  return (
    <div
      id={`chapter-opinion-${note.id}`}
      className="chapter-annotation-card"
      data-active={active}
      data-status={note.status}
    >
      <header className="chapter-annotation-main">
        <button
          type="button"
          className={`chapter-note-toggle${collapsed ? " is-collapsed" : ""}${note.persisted && !collapsed ? " has-actions" : ""}`}
          aria-expanded={active}
          onClick={onToggle}
        >
          <strong>{collapsed ? status : label}</strong>
          {!collapsed && status && <small>{status}</small>}
          {summary && (
            <span className="chapter-note-reason">
              <SafeMarkdown
                plain
                inline
                content={
                  collapsed ? (summary.split(/\r?\n/, 1)[0] ?? "") : summary
                }
              />
            </span>
          )}
        </button>
        {!collapsed && note.persisted && !reverted && (
          <div className="chapter-annotation-actions">
            <button
              type="button"
              aria-label={c.accept}
              title={c.accept}
              aria-pressed={note.status === "accepted"}
              disabled={review.pending || note.status === "accepted"}
              onClick={() => void review.update(note, { status: "accepted" })}
            >
              ✓
            </button>
            <button
              type="button"
              aria-label={action}
              title={action}
              disabled={
                review.pending ||
                (edited
                  ? !canEdit || failure === "conflict"
                  : note.status === "dismissed")
              }
              onClick={() =>
                void (edited
                  ? review.changeEdit(note)
                  : review.update(note, { status: "dismissed" }))
              }
            >
              ✕
            </button>
          </div>
        )}
      </header>
      {!collapsed && (
        <>
          {children}
          {note.persisted ? (
            <div className="chapter-annotation-feedback">
              {reverted && (
                <button
                  type="button"
                  className="chapter-annotation-restore"
                  disabled={
                    review.pending || !canEdit || failure === "conflict"
                  }
                  onClick={() => void review.changeEdit(note)}
                >
                  {c.restore}
                </button>
              )}
              {(
                [
                  ["useful", c.useful],
                  ["not_useful", c.notUseful],
                ] as const
              ).map(([rating, text]) => (
                <button
                  type="button"
                  key={rating}
                  aria-pressed={note.usefulness === rating}
                  disabled={review.pending}
                  onClick={() =>
                    void review.update(note, {
                      usefulness: note.usefulness === rating ? null : rating,
                    })
                  }
                >
                  {text}
                </button>
              ))}
            </div>
          ) : (
            active && (
              <small className="chapter-annotation-legacy">
                {c.oldFeedback}
              </small>
            )
          )}
          {failure && (
            <div className="chapter-annotation-error" role="alert">
              <span>
                {
                  {
                    unlocated: c.missingAnchor,
                    conflict: v.conflict,
                    refresh: c.refreshFailed,
                    update: c.updateFailed,
                    rate: v.rateLimited,
                  }[failure]
                }
              </span>
              {failure === "unlocated" && canEdit && onEdit && (
                <button
                  className="ui-btn ui-btn-ghost"
                  type="button"
                  onClick={onEdit}
                >
                  {c.openEditor}
                </button>
              )}
              {(failure === "conflict" || failure === "refresh") && (
                <button
                  className="ui-btn ui-btn-ghost"
                  type="button"
                  disabled={review.pending}
                  onClick={() => void review.reload(note.id)}
                >
                  {v.refresh}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

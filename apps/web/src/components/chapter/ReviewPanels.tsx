"use client";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  chapterCopy as c,
  changeKind,
  editorDecision,
  roleName,
} from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { AnnotationCard } from "./AnnotationCard.tsx";
import { RoleInputPopover } from "./RoleInputPopover.tsx";
import {
  type ReviewAnnotations,
  showsAnnotation,
} from "./review-annotations.ts";
import {
  completedRoleCount,
  type Detail,
  type Edit,
  parseChanges,
  roleOnDeck,
  roles,
  stopped,
} from "./review-data.ts";
import type { AnnotationReview } from "./useAnnotationReview.ts";

export function RoleChain({
  data,
  credits,
  approved,
  reverifying,
}: {
  data: Detail;
  credits: readonly (bigint | null | undefined)[];
  approved: boolean;
  reverifying: boolean;
}) {
  const [open, setOpen] = useState<number>();
  const chain = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (open === undefined) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !chain.current?.contains(event.target)
      )
        setOpen(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(undefined);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  const completed = completedRoleCount(data.run.status, data.run.events);
  return (
    <ol ref={chain} className="chapter-roles" aria-label={c.progress}>
      {roles.map((role, index) => {
        const row = data.roles.findLast((item) => item.role_id === role);
        const inferred = !row && index < completed;
        const current =
          !stopped.has(data.run.status) && roleOnDeck[data.run.status] === role;
        const report = data.reports[role];
        const state =
          reverifying &&
          (role === "qingjie-heyanyuan" || role === "xianshi-heyanyuan")
            ? "working"
            : row?.status === "failed" ||
                row?.status === "usage_unknown" ||
                row?.status === "blocked"
              ? "failed"
              : row?.status === "completed" || report || inferred
                ? "done"
                : !stopped.has(data.run.status) &&
                    (row?.status === "running" || current)
                  ? "working"
                  : "waiting";
        const points = inferred ? undefined : credits[index];
        const workingLabel = c.roleWorking[index];
        const message =
          state === "done"
            ? points === undefined
              ? c.accountUsage
              : points === null
                ? c.unknownUsage
                : c.points(points)
            : state === "working"
              ? workingLabel
              : state === "failed"
                ? c.incomplete
                : role === "jiyi-weihuyuan" && !approved
                  ? c.afterApproval
                  : c.waiting;
        return (
          <li key={role} className={`chapter-role role-${index} is-${state}`}>
            <button
              type="button"
              aria-expanded={open === index}
              onClick={() => setOpen(open === index ? undefined : index)}
            >
              <span className="chapter-role-dot" aria-hidden="true">
                {state === "done" ? "✓" : state === "failed" ? "!" : ""}
              </span>
              <strong>{roleName[role]}</strong>
              <small>{message}</small>
            </button>
            {open === index && (
              <RoleInputPopover
                role={role}
                manifest={row?.inputManifest}
                fallback={c.roleAccess[index]}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function EditDecision({
  data,
  edits,
  showRevision,
}: {
  data: Detail;
  edits: Edit[];
  showRevision: () => void;
}) {
  const editor = data.reports["wenxue-bianji"]?.output;
  if (
    !editor ||
    typeof editor !== "object" ||
    !("decision" in editor) ||
    typeof editor.decision !== "string"
  )
    return null;
  const decision =
    editorDecision[editor.decision as keyof typeof editorDecision];
  if (!decision) return null;
  const local = editor.decision === "LOCAL_EDIT";
  const reason =
    "return_reason" in editor && typeof editor.return_reason === "string"
      ? editor.return_reason
      : undefined;
  const shownInNextStep =
    (editor.decision === "RESTAGE" ||
      editor.decision === "RETURN_CONSTRUCTION") &&
    data.run.status === "RETURNED" &&
    Boolean(
      data.run.returnReason && reason?.trim() === data.run.returnReason.trim(),
    );
  const span = edits.reduce(
    (total, edit) => total + Array.from(edit.original).length,
    0,
  );
  const percent = data.original
    ? ((100 * span) / Array.from(data.original).length).toFixed(1)
    : undefined;
  const archived = [
    ...parseChanges(data.factChanges),
    ...parseChanges(data.literaryChanges),
  ];
  const facts = edits.filter((edit) => edit.kind === "fact").length;
  return (
    <section
      className={`chapter-edit-decision${local ? "" : " chapter-problem"}`}
    >
      <div>
        <strong>
          {local && edits.length === 0
            ? c.noEdits
            : shownInNextStep
              ? decision
              : `${c.decision} · ${decision}`}
        </strong>
        {local
          ? edits.length > 0 && (
              <span>
                {c.editSummary(
                  edits.length,
                  percent,
                  facts,
                  edits.length - facts,
                )}
              </span>
            )
          : reason && !shownInNextStep && <SafeMarkdown content={reason} />}
      </div>
      {local &&
        edits.length > 0 &&
        data.original &&
        data.original !== data.prose && (
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            onClick={showRevision}
          >
            {c.original}
          </button>
        )}
      {archived.length > 0 && (
        <details className="chapter-archived">
          <summary>{c.archivedChanges}</summary>
          <ul>
            {archived.map((edit, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Saved change rows are immutable and carry no IDs.
              <li key={`${index}-${edit.before}`}>
                <strong>{changeKind[edit.kind]}</strong>{" "}
                <del>
                  <SafeMarkdown plain inline content={edit.before} />
                </del>
                <ins>
                  <SafeMarkdown
                    plain
                    inline
                    content={edit.after || c.deleted}
                  />
                </ins>
                <SafeMarkdown content={edit.reason} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function Verdicts({
  reviews,
  review,
  area,
  staleBasis,
}: {
  reviews: ReviewAnnotations;
  review: AnnotationReview;
  area: RefObject<HTMLDivElement | null>;
  staleBasis?: string | undefined;
}) {
  if (!reviews.verdicts.some(({ pass }) => pass !== undefined)) return null;
  return (
    <section
      id="chapter-verification"
      className="chapter-checks"
      aria-label={c.checks}
    >
      <h2>{c.checks}</h2>
      <div className="chapter-verdicts" ref={area}>
        {reviews.verdicts.map(({ role, pass, issues }, index) => (
          <article className={`chapter-verdict role-${index + 3}`} key={role}>
            <header>
              <h3>{roleName[role]}</h3>
              <div className="chapter-verdict-meta">
                <strong
                  className={pass === false ? "chapter-verdict-fail" : ""}
                >
                  {pass === true
                    ? c.passed
                    : pass === false
                      ? c.failed
                      : c.unchecked}
                </strong>
                {staleBasis && (
                  <small className="chapter-verdict-basis">{staleBasis}</small>
                )}
              </div>
            </header>
            {issues
              .filter(({ annotation }) =>
                showsAnnotation(annotation, review.filter),
              )
              .map(({ finding: issue, annotation }) => {
                const label = issue.problem
                  ? c.problems[issue.problem as keyof typeof c.problems]
                  : c.categories[issue.category as keyof typeof c.categories];
                return (
                  <div
                    key={annotation.id}
                    className={`chapter-verdict-issue is-${annotation.kind}`}
                  >
                    <AnnotationCard
                      note={annotation}
                      label={label ?? roleName[role]}
                      summary={issue.evidence ?? issue.promise ?? ""}
                      review={review}
                      onToggle={() =>
                        review.setActive(
                          review.active === annotation.id
                            ? undefined
                            : annotation.id,
                        )
                      }
                    >
                      {(issue.promise || issue.rule_ref) && (
                        <div className="chapter-note-detail">
                          {issue.promise && (
                            <p>
                              {c.requiredEvent} ·{" "}
                              <SafeMarkdown
                                plain
                                inline
                                content={issue.promise}
                              />
                            </p>
                          )}
                          {issue.rule_ref && (
                            <p>
                              {c.rule} ·{" "}
                              <SafeMarkdown
                                plain
                                inline
                                content={issue.rule_ref}
                              />
                            </p>
                          )}
                        </div>
                      )}
                    </AnnotationCard>
                  </div>
                );
              })}
          </article>
        ))}
      </div>
    </section>
  );
}

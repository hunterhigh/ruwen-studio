"use client";
import type {
  IdeationApprovalReceipt,
  IdeationFilePatch,
  IdeationPreviewV1_2 as IdeationPreview,
} from "@ruwen/pipeline";
import { type ReactNode, useState } from "react";
import {
  ideationCopy as c,
  errorCopy,
  kindNames,
  previewStatus,
  roleName,
} from "../../copy/zh-CN.ts";
import { ConfirmDialog } from "../../ui/ConfirmDialog.tsx";
import { KeyValueList } from "../../ui/KeyValueList.tsx";
import { SealButton } from "../../ui/SealButton.tsx";
import { TextDiff } from "../diff/TextDiff.tsx";
import { SafeMarkdown } from "../SafeMarkdown.tsx";

export function previewKind(preview: IdeationPreview) {
  return preview.kind === "handoff" ? c.handoff : kindNames[preview.kind];
}

export function ideationTime(value: string) {
  const instant = new Date(value);
  return Number.isFinite(instant.valueOf())
    ? new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(instant)
    : "";
}

function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <dt>{title}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Lines({ items }: { items: readonly string[] }) {
  return (
    <ul className="ideation-lines">
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: A preview can repeat a literal line.
        <li key={index}>
          <SafeMarkdown inline content={item} />
        </li>
      ))}
    </ul>
  );
}

function Paths({ items }: { items: readonly string[] }) {
  return (
    <ul className="ideation-paths">
      {[...new Set(items)].map((path) => (
        <li key={path}>
          <SafeMarkdown plain inline content={path} />
        </li>
      ))}
    </ul>
  );
}

function Text({ value }: { value: string }) {
  return (
    <div className="ideation-paper-text">
      <SafeMarkdown content={value} />
    </div>
  );
}

function Patches({ items }: { items: readonly IdeationFilePatch[] }) {
  return items.map((patch) => {
    const path = patch.kind === "create" ? patch.path : patch.resource.path;
    return (
      <details className="ideation-patch" key={path}>
        <summary>
          <SafeMarkdown plain inline content={path} />
          <small>
            {patch.kind === "create" ? c.newFile : c.sectionReplacement}
          </small>
        </summary>
        <TextDiff
          before={patch.kind === "create" ? "" : patch.beforeText}
          after={patch.kind === "create" ? patch.content : patch.afterText}
        />
      </details>
    );
  });
}

function PreviewFields({
  preview,
  sources,
  externalSearch,
}: {
  preview: IdeationPreview;
  sources: ReadonlyMap<string, string>;
  externalSearch: boolean;
}) {
  switch (preview.kind) {
    case "handoff": {
      const { understanding, handoff } = preview;
      const paths = handoff.resource_ids.flatMap((id) => {
        const path = sources.get(id);
        return path ? [path] : [];
      });
      const unresolved = handoff.resource_ids.length - paths.length;
      const payload =
        typeof handoff.payload === "string"
          ? handoff.payload
          : handoff.kind === "creative_brief"
            ? {
                ...handoff.payload,
                excluded_source: handoff.payload.excluded_source.map(
                  (key) => c.excluded[key],
                ),
              }
            : handoff.payload;
      return (
        <>
          <p className="ideation-card-help">{c.handoffHelp}</p>
          <dl className="ideation-fields">
            <Field title={c.recipient}>
              <span className="ideation-tag">
                {roleName[handoff.recipient]}
              </span>
            </Field>
            <Field title={c.creativeValue}>
              <SafeMarkdown content={understanding.creativeValue} />
            </Field>
            <Field title={c.fixedFacts}>
              <Lines items={understanding.fixedFacts} />
            </Field>
            {understanding.openChoices.length > 0 && (
              <Field title={c.openChoices}>
                <Lines items={understanding.openChoices} />
              </Field>
            )}
            {understanding.exampleTreatment && (
              <Field title={c.exampleTreatment}>
                <SafeMarkdown content={understanding.exampleTreatment} />
              </Field>
            )}
            <Field title={c.destination}>
              <SafeMarkdown plain inline content={understanding.destination} />
            </Field>
            <Field title={c.payload}>
              {typeof payload === "string" ? (
                <Text value={payload} />
              ) : (
                <div className="ideation-paper-text">
                  <KeyValueList value={payload} />
                </div>
              )}
            </Field>
            {handoff.resource_ids.length > 0 && (
              <Field title={c.resources}>
                <Paths items={paths} />
                {unresolved > 0 && <small>{c.resourceCount(unresolved)}</small>}
              </Field>
            )}
          </dl>
        </>
      );
    }
    case "file_patch":
      return (
        <>
          <p className="ideation-card-help">
            {c.fileCount(roleName[preview.role], preview.patches.length)}
          </p>
          <SafeMarkdown content={preview.explanation} />
          <Patches items={preview.patches} />
        </>
      );
    case "learning_plan":
      return (
        <>
          {preview.status === "pending" &&
            preview.sourceMode === "external_search" &&
            !externalSearch && (
              <p className="ideation-error">{errorCopy.SEARCH_UNAVAILABLE}</p>
            )}
          <p className="ideation-card-help">{c.learningHelp}</p>
          <dl className="ideation-fields">
            <Field title={c.known}>
              <SafeMarkdown content={preview.known} />
            </Field>
            <Field title={c.unknown}>
              <SafeMarkdown content={preview.unknown} />
            </Field>
            <Field title={c.plan}>
              <Lines items={preview.plan} />
            </Field>
            <Field title={c.boundary}>
              <SafeMarkdown content={preview.boundary} />
            </Field>
            {preview.potentialConflicts.length > 0 && (
              <Field title={c.potentialConflicts}>
                <Lines items={preview.potentialConflicts} />
              </Field>
            )}
            <Field title={c.destination}>
              <SafeMarkdown plain inline content={preview.destination} />
            </Field>
            <Field title={c.sourceMode}>{c.sources[preview.sourceMode]}</Field>
          </dl>
        </>
      );
    case "expression_candidate": {
      const activation = preview.approvalStage === "activation";
      const patch = preview.patches.find((item) =>
        item.kind === "create"
          ? item.resourceId === preview.resource.id
          : item.resource.id === preview.resource.id,
      );
      return (
        <>
          <p className="ideation-card-help">
            {activation ? c.activationHelp : c.candidateHelp}
          </p>
          {preview.status === "pending" &&
            preview.closureAudit.status !== "passed" && (
              <p className="ideation-error">
                {errorCopy.CLOSURE_AUDIT_REQUIRED}
              </p>
            )}
          {preview.status === "pending" &&
            activation &&
            (preview.trial.status !== "passed" || !preview.trial.sample) && (
              <p className="ideation-error">
                {errorCopy.NONCANONICAL_TRIAL_REQUIRED}
              </p>
            )}
          <dl className="ideation-fields">
            {patch && (
              <Field title={c.expression}>
                <Text
                  value={
                    patch.kind === "create" ? patch.content : patch.afterText
                  }
                />
              </Field>
            )}
            <Field title={c.audit}>
              <strong>{c.result[preview.closureAudit.status]}</strong>
              <ul className="ideation-audit">
                {preview.closureAudit.checks.map((check) => (
                  <li key={check.category} data-pass={check.resolved}>
                    <strong>
                      {check.resolved ? "✓" : "✕"}{" "}
                      {c.auditNames[check.category]}
                    </strong>
                    <SafeMarkdown content={check.summary} />
                  </li>
                ))}
              </ul>
            </Field>
            {activation && (
              <Field title={c.trial}>
                <small>
                  {c.trialHelp} · {c.result[preview.trial.status]}
                </small>
                {preview.trial.sample && <Text value={preview.trial.sample} />}
              </Field>
            )}
          </dl>
        </>
      );
    }
    case "generation_field":
      return (
        <>
          <p className="ideation-card-help">{c.generationHelp}</p>
          <dl className="ideation-fields">
            <Field title={c.chapter}>
              {c.chapterName(Number(preview.chapter))}
            </Field>
            <Field title={c.lockedEvents}>
              <Lines items={preview.lockedEvents} />
            </Field>
            <Field title={c.lockedOrder}>
              <Lines items={preview.lockedOrder} />
            </Field>
            <Field title={c.generationField}>
              <small>{c.inputCount(preview.characterCount, 2200)}</small>
              <Text value={preview.generationField} />
            </Field>
            <Field title={c.approvedSources}>
              <Paths items={preview.approvedSources.map(({ path }) => path)} />
            </Field>
          </dl>
        </>
      );
    case "verbatim":
      return (
        <>
          <p className="ideation-card-help">{c.verbatimHelp}</p>
          <dl className="ideation-fields">
            <Field title={c.verbatimText}>
              <blockquote className="ideation-paper-text">
                <SafeMarkdown plain content={preview.text} />
              </blockquote>
            </Field>
            <Field title={c.verbatimTarget}>
              {preview.target.kind === "current_chapter" ? (
                <>
                  {c.chapterName(Number(preview.target.chapter))} ·{" "}
                  {c.inputCount(
                    preview.characterCount,
                    preview.target.maximumCharacters,
                  )}
                </>
              ) : (
                <>
                  <SafeMarkdown
                    plain
                    inline
                    content={preview.target.resource.path}
                  />
                  <p>{c.verbatimAppend}</p>
                  {preview.target.separator === "\n" && (
                    <small>{c.verbatimSeparator}</small>
                  )}
                </>
              )}
            </Field>
            <Field title={c.verbatimReaders}>
              {preview.target.kind === "current_chapter"
                ? c.chapterReaders
                : c.fileReaders}
            </Field>
          </dl>
        </>
      );
  }
}

export function PreviewCard({
  preview,
  busy,
  canRevise,
  externalSearch,
  sources,
  receipt,
  startedRole,
  error,
  onNewer,
  onAction,
}: {
  preview: IdeationPreview;
  busy: boolean;
  canRevise: boolean;
  externalSearch: boolean;
  sources: ReadonlyMap<string, string>;
  receipt: IdeationApprovalReceipt | undefined;
  startedRole: string | undefined;
  error: ReactNode;
  onNewer: (() => void) | undefined;
  onAction: (
    kind: "approve" | "reject" | "revise",
    text: string,
    trialRead: boolean,
  ) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [trialRead, setTrialRead] = useState(false);
  const [revising, setRevising] = useState(false);
  const [text, setText] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const activation =
    preview.kind === "expression_candidate" &&
    preview.approvalStage === "activation";
  const availableTrial =
    preview.kind === "expression_candidate" &&
    preview.trial.status === "passed" &&
    Boolean(preview.trial.sample);
  const blocked =
    (preview.kind === "expression_candidate" &&
      preview.closureAudit.status !== "passed") ||
    (activation && (!availableTrial || !trialRead));
  const pending = preview.status === "pending";
  const canRequestRevision =
    preview.kind !== "verbatim" && (pending || preview.status === "stale");
  const when = receipt && ideationTime(receipt.createdAt);
  return (
    <article className="ideation-preview-card" aria-label={c.previewDetails}>
      {receipt ? (
        <p className="ideation-receipt-heading">
          {when ? (
            <time dateTime={receipt.createdAt}>{c.approvedReceipt(when)}</time>
          ) : (
            previewStatus.approved
          )}
        </p>
      ) : (
        !pending && (
          <small className="ideation-card-status">
            {previewStatus[preview.status]}
          </small>
        )
      )}
      <h2>
        {c.previewTitle(
          preview.kind === "file_patch" ? c.filePatch : kindNames[preview.kind],
        )}
        <SafeMarkdown plain inline content={preview.summary} />
      </h2>
      <PreviewFields
        preview={preview}
        sources={sources}
        externalSearch={externalSearch}
      />
      {receipt && (
        <section className="ideation-receipt" aria-label={c.receipt}>
          <dl className="ideation-fields">
            {receipt.committedFiles.length > 0 && (
              <Field title={c.committedFiles}>
                <Paths items={receipt.committedFiles.map(({ path }) => path)} />
              </Field>
            )}
            {receipt.startedTaskId && (
              <Field title={c.startedTask}>
                {startedRole ?? c.downstreamTask}
              </Field>
            )}
          </dl>
          {receipt.projectionRegistered && <p>{c.projectionRegistered}</p>}
        </section>
      )}
      {(pending ||
        preview.status === "stale" ||
        preview.status === "superseded") && (
        <section className="ideation-decision">
          {error}
          {!pending && (
            <p className="ideation-error">
              {preview.status === "stale"
                ? preview.kind === "verbatim"
                  ? c.staleVerbatim
                  : c.stalePreview
                : c.supersededPreview}
              {onNewer && (
                <button
                  className="ui-btn ui-btn-ghost"
                  type="button"
                  onClick={onNewer}
                >
                  {c.newerPreview}
                </button>
              )}
            </p>
          )}
          {pending && (
            <>
              {activation && (
                <label className="ideation-check">
                  <input
                    type="checkbox"
                    checked={trialRead}
                    disabled={busy || !availableTrial}
                    onChange={(event) => setTrialRead(event.target.checked)}
                  />
                  {c.trialRead}
                </label>
              )}
              <label className="ideation-check">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {activation ? c.confirmActivation : c.confirm[preview.kind]}
              </label>
            </>
          )}
          <div className="decision-actions">
            {pending && (
              <SealButton
                disabled={busy || !confirmed || blocked}
                onClick={() => onAction("approve", "", trialRead)}
              >
                {activation ? c.activate : c.approve[preview.kind]}
              </SealButton>
            )}
            {canRequestRevision && (
              <button
                className="ui-btn ui-btn-ghost"
                type="button"
                disabled={busy || !canRevise}
                aria-expanded={revising && canRevise}
                onClick={() => setRevising(!revising)}
              >
                {c.openRevision}
              </button>
            )}
            {pending && (
              <button
                className="ui-btn ui-btn-danger-text"
                type="button"
                disabled={busy}
                onClick={() => {
                  setReason("");
                  setRejecting(true);
                }}
              >
                {c.reject}
              </button>
            )}
          </div>
          {canRequestRevision && !canRevise && (
            <small>{c.revisionClosed}</small>
          )}
          {canRequestRevision && revising && canRevise && (
            <form
              className="ideation-revision"
              onSubmit={(event) => {
                event.preventDefault();
                if (text.trim()) onAction("revise", text, false);
              }}
            >
              <label>
                {c.revisionLabel}
                <textarea
                  rows={3}
                  value={text}
                  placeholder={c.revisionPlaceholder}
                  onChange={(event) => setText(event.target.value)}
                />
              </label>
              <button
                className="ui-btn ui-btn-primary"
                type="submit"
                disabled={busy || !text.trim()}
              >
                {c.sendRevision}
              </button>
            </form>
          )}
        </section>
      )}
      {rejecting && (
        <ConfirmDialog
          {...c.rejectConfirmation}
          onCancel={() => setRejecting(false)}
          onConfirm={() => {
            setRejecting(false);
            onAction("reject", reason, false);
          }}
        >
          <label>
            {c.rejectReason}
            <textarea
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </ConfirmDialog>
      )}
    </article>
  );
}

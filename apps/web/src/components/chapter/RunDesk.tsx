"use client";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  chapterCopy as c,
  confirmation,
  errorCopy,
  memoryCopy,
  runStatus,
  runStatusTone,
  candidateCopy as v,
} from "../../copy/zh-CN.ts";
import { useConfirm } from "../../ui/ConfirmDialog.tsx";
import { SealButton } from "../../ui/SealButton.tsx";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { ApiError, post } from "../client.ts";
import { useProjectDecisionContext } from "../project/ProjectDecisions.tsx";
import {
  applyRoleFrame,
  emptyRoleStreams,
  roleStreamText,
} from "../role-streams.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { useApi } from "../useApi.ts";
import {
  CandidateEditor,
  CandidateHistory,
  CandidateVersionNote,
  verificationBasisVersion,
} from "./CandidateVersions.tsx";
import { authorInputsSummary } from "./input-manifest-view.ts";
import { Manuscript } from "./Manuscript.tsx";
import { MemoryReview } from "./MemoryReview.tsx";
import { EditDecision, RoleChain, Verdicts } from "./ReviewPanels.tsx";
import {
  chapterTitle,
  type Detail,
  editsFrom,
  readingFrom,
  roleCredits,
  roles,
  stopped,
  timeOf,
  type Usage,
} from "./review-data.ts";
import type { RunSummary } from "./runs.ts";
import { useCandidateActions } from "./useCandidateActions.ts";

function failureCopy(detail: Detail | undefined) {
  const message = detail?.run.error ?? "";
  if (/truncat|max_tokens|截断/i.test(message)) return c.truncated;
  if (/interrupt|unknown|中断|结果未知/i.test(message)) return c.interrupted;
  if (/anchor not found|找不到.*锚点/i.test(message)) return c.invalidEdit;
  if (/output.*(?:blocked|security)|安全检查/i.test(message)) return c.blocked;
  return c.failure;
}

export function RunDesk({
  row,
  projectId,
  historyControls,
  readOnly,
  attempt,
  memory,
  onChanged,
  onNewAttempt,
}: {
  row: RunSummary & { chapter: string };
  projectId: string;
  historyControls: ReactNode;
  readOnly: boolean;
  attempt: number;
  memory: boolean;
  onChanged: () => Promise<RunSummary[] | undefined>;
  onNewAttempt: () => void;
}) {
  const id = row.id;
  const confirm = useConfirm();
  const { refresh: refreshDecisions } = useProjectDecisionContext();
  const { data, error: loadError, refresh } = useApi<Detail>(`/api/runs/${id}`);
  const { data: account, refresh: refreshAccount } = useApi<{ usage: Usage[] }>(
    "/api/account",
  );
  const [streams, setStreams] = useState(emptyRoleStreams);
  const [connected, setConnected] = useState(false);
  const [revised, setRevised] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [revisionHint, setRevisionHint] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<string>();
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [sealRequested, setSealRequested] = useState(false);
  const [reading, setReading] = useState({
    key: "",
    end: false,
    verdicts: false,
  });
  const end = useRef<HTMLDivElement>(null);
  const verdicts = useRef<HTMLDivElement>(null);
  const returnInput = useRef<HTMLTextAreaElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const status = data?.run.status ?? row.status;
  const inputSummary = authorInputsSummary(
    data?.roles.findLast(({ role_id }) => role_id === "xiaoshuo-zuozhe")
      ?.inputManifest,
  );
  const terminal = stopped.has(status);
  const digest = data?.run.candidateSha256 ?? "";
  const readingKey = `${digest}:${data?.run.verificationRunId ?? ""}`;
  const waiting = status === "AWAITING_CANDIDATE_APPROVAL";
  const revision = useCandidateActions(id, data, waiting && !readOnly, refresh);
  const versions = data?.run.candidateVersions ?? [];
  const current = versions.find(
    ({ version }) => version === data?.run.candidateVersion,
  );
  const historical = versions.find(
    ({ version }) =>
      version === selectedVersion && version !== current?.version,
  );
  const previous = (version: number) =>
    versions.findLast((item) => item.version < version)?.version;
  const userVersions = versions.filter(({ source }) => source === "user");
  const revisited = Boolean(revision.draft || historical);
  const verificationStale = Boolean(
    digest &&
      data?.run.verificationBasisSha256 &&
      data.run.verificationBasisSha256 !== digest,
  );
  const staleBasis =
    verificationStale && data
      ? v.staleBasis(verificationBasisVersion(data.run, versions))
      : undefined;
  const decisionPending = waiting || status === "AWAITING_MEMORY_APPROVAL";
  const wasDecisionPending = useRef(false);
  const approvedAt = timeOf(data?.run, "CANDIDATE_APPROVED");
  const approved =
    Boolean(approvedAt) ||
    [
      "CANDIDATE_APPROVED",
      "MEMORY_PREVIEW_READY",
      "AWAITING_MEMORY_APPROVAL",
      "MEMORY_COMMITTED",
      "DONE",
    ].includes(status);
  const finishedAt = timeOf(data?.run, "DONE");
  const eventTime = terminal ? timeOf(data?.run, status) : undefined;
  const writing = ["REQUESTED", "READINESS_OK", "PACKET_COMPILED"].includes(
    status,
  );
  const prose =
    data?.prose || roleStreamText(streams, id, id, "xiaoshuo-zuozhe");
  const chapter = c.chapter(Number(row.chapter));
  const title = chapterTitle(prose);
  const edits = editsFrom(data?.reports["wenxue-bianji"]?.output);
  const reactions = readingFrom(data?.reports["qinggan-duzhe"]?.output);
  const credits = roles.map((role) =>
    roleCredits(account?.usage ?? [], id, role),
  );
  const known = credits.filter(
    (points): points is bigint => typeof points === "bigint",
  );
  const total = known.reduce((sum, points) => sum + points, 0n);
  const completeCredits = data?.roles
    .filter((role) => role.status === "completed" || role.status === "failed")
    .every((role) =>
      roles.some(
        (name, index) =>
          name === role.role_id && typeof credits[index] === "bigint",
      ),
    );
  const mutable = !readOnly && !terminal && Boolean(data);
  const pending = accepted !== undefined && accepted === status;
  const locked = busy || pending || revision.saving || revision.needsRefresh;

  useEffect(() => {
    if (wasDecisionPending.current === decisionPending) return;
    wasDecisionPending.current = decisionPending;
    // Approval is queued. Read again when the saved status enters or leaves the pending count.
    refreshDecisions();
  }, [decisionPending, refreshDecisions]);

  useEffect(() => {
    if (terminal) return;
    const source = new EventSource(`/api/runs/${id}/events`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    const consume = (type: "delta" | "reset", event: MessageEvent<string>) => {
      try {
        const value = JSON.parse(event.data) as {
          role: (typeof roles)[number];
          text?: string;
        };
        if (roles.includes(value.role))
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
        /* Saved details remain authoritative. */
      }
    };
    source.addEventListener("delta", (event: MessageEvent<string>) =>
      consume("delta", event),
    );
    source.addEventListener("reset", (event: MessageEvent<string>) =>
      consume("reset", event),
    );
    source.addEventListener("status", () => {
      void refresh();
      void refreshAccount();
      void onChanged();
    });
    return () => source.close();
  }, [id, terminal, refresh, refreshAccount, onChanged]);

  useEffect(() => {
    setReading({ key: readingKey, end: false, verdicts: false });
    if (!waiting || !digest || readOnly || memory || revisited) return;
    const endMarker = end.current;
    const verdictCards = [...(verdicts.current?.children ?? [])];
    const seen = new Set<Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.intersectionRatio < 0.6) continue;
          seen.add(entry.target);
          observer.unobserve(entry.target);
        }
        setReading({
          key: readingKey,
          end: Boolean(endMarker && seen.has(endMarker)),
          verdicts:
            verdictCards.length === 2 &&
            verdictCards.every((card) => seen.has(card)),
        });
      },
      { threshold: 0.6 },
    );
    if (endMarker) observer.observe(endMarker);
    for (const card of verdictCards) observer.observe(card);
    return () => observer.disconnect();
  }, [digest, readingKey, waiting, readOnly, memory, revisited]);

  async function action(kind: string, body: Record<string, unknown> = {}) {
    if (!mutable || locked) return;
    setBusy(true);
    setError("");
    try {
      await post(`/api/runs/${id}/${kind}`, body);
      refreshDecisions();
      if (kind.startsWith("approve-")) setAccepted(status);
      if (kind === "approve-candidate") setSealRequested(true);
      await refresh();
      void refreshAccount();
      void onChanged();
    } catch (cause) {
      if (kind.startsWith("approve-")) await refresh();
      setError(
        cause instanceof ApiError && cause.code
          ? (errorCopy[cause.code as keyof typeof errorCopy] ??
              errorCopy.INTERNAL_ERROR)
          : cause instanceof ApiError && kind.startsWith("approve-")
            ? c.approvalError
            : errorCopy.INTERNAL_ERROR,
      );
    } finally {
      setBusy(false);
    }
  }
  function approve(kind: "candidate" | "memory") {
    const expectedSha256 =
      kind === "candidate" ? digest : data?.run.memoryPreviewSha256;
    if (!expectedSha256) return;
    if (
      kind === "candidate" &&
      !(
        waiting &&
        !revisited &&
        !revision.checking &&
        reading.key === readingKey &&
        reading.end &&
        reading.verdicts
      )
    )
      return;
    void action(`approve-${kind}`, {
      confirmed: true,
      expectedSha256,
      ...(data?.run.targetBeforeSha256
        ? { expectedTargetSha256: data.run.targetBeforeSha256 }
        : {}),
    });
  }
  const abandon = async () => {
    if (await confirm(confirmation.cancelRun)) await action("cancel");
  };
  const reviewUrl = `/projects/${projectId}/chapters?run=${encodeURIComponent(id)}`;
  if (memory && data?.run.memoryPreviewSha256) {
    return (
      <MemoryReview
        data={data}
        chapter={chapter}
        reviewUrl={reviewUrl}
        overviewUrl={`/projects/${projectId}`}
        readOnly={readOnly}
        busy={locked}
        error={error || (loadError ? errorCopy.INTERNAL_ERROR : "")}
        onApprove={() => approve("memory")}
        onAbandon={async () => {
          if (await confirm(memoryCopy.abandonConfirmation))
            await action("cancel");
        }}
      />
    );
  }
  const memoryCount = data?.memoryFiles.length ?? 0;
  async function showMode(nextRevised: boolean) {
    if (revision.draft && !(await revision.leave())) return;
    setSelectedVersion(undefined);
    setRevised(nextRevised);
  }
  async function showVersion(version: number) {
    if (revision.draft && !(await revision.leave())) return;
    setRevised(false);
    setSelectedVersion(version === current?.version ? undefined : version);
  }
  return (
    <section
      ref={workspace}
      className="run-workspace chapter-workspace"
      aria-label={c.workspace}
    >
      <header className="chapter-heading">
        <div>
          <h1>
            <SafeMarkdown
              plain
              inline
              content={title ? `${chapter} · ${title}` : chapter}
            />
          </h1>
          <div className="chapter-status-row">
            <StatusBadge tone={runStatusTone[status] ?? "stop"}>
              <span data-testid="run-status">
                {runStatus[status] ?? c.unknownStatus}
              </span>
            </StatusBadge>
            {!terminal && (
              <span className="chapter-connection">
                <i className={connected ? "connected" : ""} />
                {connected ? c.connected : c.reconnecting}
              </span>
            )}
            {known.length > 0 && completeCredits && (
              <span>{c.used(total)}</span>
            )}
            {finishedAt && (
              <time dateTime={finishedAt}>
                {c.finishedAt(new Date(finishedAt).toLocaleString("zh-CN"))}
              </time>
            )}
          </div>
        </div>
        {historyControls}
        {inputSummary && (
          <p className="chapter-input-summary">{inputSummary}</p>
        )}
      </header>
      {readOnly && (
        <p className="chapter-info">
          {c.historical(attempt)}{" "}
          {eventTime && (
            <time dateTime={eventTime}>
              {c.endedAt(new Date(eventTime).toLocaleString("zh-CN"))}
            </time>
          )}
        </p>
      )}
      {(error || loadError) && (
        <p className="chapter-problem" role="alert">
          {error || errorCopy.INTERNAL_ERROR}
        </p>
      )}
      {revision.needsRefresh && (
        <div className="chapter-problem chapter-version-banner" role="alert">
          <span>{v.savedRefreshFailed}</span>
          <button
            className="ui-btn ui-btn-ghost"
            type="button"
            disabled={revision.saving}
            onClick={() => void revision.reload()}
          >
            {v.refresh}
          </button>
        </div>
      )}
      {status === "RETURNED" && (
        <section className="chapter-problem">
          <h2>{c.next}</h2>
          <p>{c.paused}</p>
          {data?.run.returnReason &&
            data.run.reverification?.status !== "returned" && (
              <>
                <strong>{c.returned}</strong>
                <SafeMarkdown content={data.run.returnReason} />
              </>
            )}
          {!readOnly && (
            <div className="chapter-actions">
              <a
                className="ui-btn ui-btn-ghost"
                href={`/projects/${projectId}/ideation`}
              >
                {c.toIdeation}
              </a>
              <button
                className="ui-btn ui-btn-primary"
                type="button"
                onClick={onNewAttempt}
              >
                {c.newAttempt}
              </button>
            </div>
          )}
        </section>
      )}
      {(status === "FAILED" || status === "FAILED_PRECONDITION") && (
        <section className="chapter-problem" role="alert">
          <h2>
            {status === "FAILED_PRECONDITION" ? c.notReady : runStatus.FAILED}
          </h2>
          {status === "FAILED_PRECONDITION" ? (
            <a href={`/projects/${projectId}`}>{c.overview}</a>
          ) : (
            <>
              <p>{failureCopy(data)}</p>
              {!readOnly && (
                <button
                  className="ui-btn ui-btn-primary"
                  type="button"
                  onClick={onNewAttempt}
                >
                  {c.newAttempt}
                </button>
              )}
            </>
          )}
        </section>
      )}
      {data && (
        <RoleChain
          data={data}
          credits={roles.map((role, index) =>
            data.run.verificationRunId && (index === 3 || index === 4)
              ? roleCredits(
                  account?.usage ?? [],
                  data.run.verificationRunId,
                  role,
                )
              : credits[index],
          )}
          approved={approved}
          reverifying={revision.checking}
        />
      )}
      {data && (
        <EditDecision
          data={data}
          edits={edits}
          showRevision={async () => {
            if (revision.draft && !(await revision.leave())) return;
            const author = versions.find(({ source }) => source === "author");
            if (current?.source === "user" && author) {
              setRevised(false);
              setSelectedVersion(author.version);
              return;
            }
            setSelectedVersion(undefined);
            setRevised(true);
            setRevisionHint(true);
            requestAnimationFrame(() =>
              workspace.current
                ?.querySelector(".chapter-tools")
                ?.scrollIntoView({ block: "center" }),
            );
          }}
        />
      )}
      {revisionHint && revised && !revisited && (
        <p className="chapter-info">{c.revisionHelp}</p>
      )}
      <Manuscript
        prose={prose}
        original={data?.original ?? ""}
        edits={edits}
        reactions={reactions}
        revised={revised}
        setRevised={setRevised}
        currentUserVersion={current?.source === "user"}
        controls={
          <div className="chapter-view-controls">
            <div className="chapter-segment">
              <button
                type="button"
                aria-pressed={!revisited && !revised}
                onClick={() => void showMode(false)}
              >
                {c.clean}
              </button>
              <button
                type="button"
                aria-pressed={!revisited && revised}
                disabled={!data?.original && current?.source !== "user"}
                onClick={() => void showMode(true)}
              >
                {c.revised}
              </button>
              {mutable && waiting && !historical && (
                <button
                  type="button"
                  aria-pressed={Boolean(revision.draft)}
                  disabled={locked}
                  onClick={() => {
                    if (revision.draft) return;
                    setSelectedVersion(undefined);
                    setReturning(false);
                    setRevised(false);
                    revision.startEditing();
                  }}
                >
                  {v.modify}
                </button>
              )}
            </div>
            {current && versions.length > 1 && (
              <label className="chapter-version-select">
                <span>{v.version}</span>
                <select
                  value={historical?.version ?? current.version}
                  disabled={revision.saving}
                  onChange={(event) =>
                    void showVersion(Number(event.target.value))
                  }
                >
                  {versions.map((item) => (
                    <option key={item.version} value={item.version}>
                      {item.source === "author"
                        ? v.author
                        : item.source === "editor"
                          ? v.editorVersion
                          : v.userVersion(userVersions.indexOf(item) + 1)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        }
        note={
          current?.source === "user" && (
            <CandidateVersionNote
              id={id}
              version={current.version}
              previous={previous(current.version)}
              text={prose}
            />
          )
        }
        alternate={
          revision.draft ? (
            <CandidateEditor
              text={revision.draft.text}
              disabled={revision.saving}
              conflict={revision.conflicted}
              error={revision.draftError}
              onChange={revision.changeDraft}
              onReload={() => void revision.reload()}
            />
          ) : historical ? (
            <CandidateHistory
              key={historical.version}
              id={id}
              version={historical.version}
              previous={previous(historical.version)}
              onLatest={() => void showMode(false)}
            />
          ) : undefined
        }
        chapter={chapter}
        title={title || chapter}
        candidate={Boolean(digest)}
        approved={approved}
        approvedAt={approvedAt}
        animateSeal={sealRequested}
        writing={writing}
        end={end}
        complete={Boolean(digest && prose)}
      />
      {data && !revisited && (
        <Verdicts data={data} area={verdicts} staleBasis={staleBasis} />
      )}
      {revision.checkError && (
        <p className="chapter-problem" role="alert">
          {revision.checkError}
        </p>
      )}
      {mutable && waiting && returning && !revisited && (
        <form
          className="chapter-return"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim()) void action("return", { reason });
          }}
        >
          <h2>{c.returnTitle}</h2>
          <p>{c.returnHelp}</p>
          <label>
            {c.returnReason}
            <textarea
              ref={returnInput}
              value={reason}
              maxLength={1000}
              required
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <small>{c.countInput(reason.length)}</small>
          <div className="chapter-actions">
            <button
              type="button"
              className="ui-btn ui-btn-ghost"
              onClick={() => setReturning(false)}
            >
              {c.collapse}
            </button>
            <button
              type="submit"
              className="ui-btn ui-btn-primary"
              disabled={locked || !reason.trim()}
            >
              {c.returnConfirm}
            </button>
          </div>
        </form>
      )}
      {revision.draft ? (
        <footer className="chapter-dock chapter-edit-dock">
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            disabled={revision.saving}
            onClick={() => void revision.leave()}
          >
            {v.discard}
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            disabled={!revision.dirty || revision.saving || revision.conflicted}
            onClick={() => void revision.save()}
          >
            {revision.saving ? v.saving : v.save}
          </button>
        </footer>
      ) : historical ? null : mutable && waiting ? (
        <footer className="chapter-dock">
          <div>
            <strong>{c.approvalQuestion(chapter)}</strong>
            <small>{pending ? c.approvePending : c.approvalHint}</small>
          </div>
          <ul className="chapter-read-conditions">
            <li data-read={reading.key === readingKey && reading.end}>
              {c.readingEnd}
            </li>
            <li data-read={reading.key === readingKey && reading.verdicts}>
              {verificationStale ? v.staleReading : c.readingVerdicts}
              {verificationStale && (
                <button
                  type="button"
                  className="chapter-reverify"
                  disabled={locked || revision.checking}
                  onClick={() => void revision.reverify()}
                >
                  {revision.checking ? v.reverifying : v.reverify}
                </button>
              )}
            </li>
          </ul>
          <div className="chapter-actions">
            <button
              type="button"
              className="ui-btn ui-btn-ghost"
              disabled={locked}
              aria-expanded={returning}
              onClick={() => {
                setReturning(!returning);
                if (!returning)
                  requestAnimationFrame(() => returnInput.current?.focus());
              }}
            >
              {c.return}
            </button>
            <button
              type="button"
              className="ui-btn ui-btn-danger-text"
              disabled={locked}
              onClick={abandon}
            >
              {c.abandon}
            </button>
            <SealButton
              disabled={
                locked ||
                revision.checking ||
                !digest ||
                reading.key !== readingKey ||
                !reading.end ||
                !reading.verdicts
              }
              onClick={() => approve("candidate")}
            >
              {c.approve}
            </SealButton>
          </div>
        </footer>
      ) : (
        mutable && (
          <footer className="chapter-dock">
            {status === "AWAITING_MEMORY_APPROVAL" ? (
              <>
                <strong>
                  {memoryCount ? c.memoryReady(memoryCount) : memoryCopy.empty}
                </strong>
                <a
                  className={`ui-btn ${memoryCount ? "ui-btn-primary" : "ui-btn-ghost"}`}
                  href={`${reviewUrl}&view=memory`}
                >
                  {c.readMemory}
                </a>
                {!memoryCount && (
                  <SealButton
                    disabled={locked || !data?.run.memoryPreviewSha256}
                    onClick={() => approve("memory")}
                  >
                    {locked ? c.approving : memoryCopy.confirmEmpty}
                  </SealButton>
                )}
              </>
            ) : (
              approved && <strong>{c.approvedPreparing}</strong>
            )}
            <button
              type="button"
              className="ui-btn ui-btn-danger-text"
              disabled={locked}
              onClick={abandon}
            >
              {c.abandon}
            </button>
          </footer>
        )
      )}
      {status === "DONE" && <p className="chapter-info">{c.done}</p>}
      {status === "CANCELLED" && <p className="chapter-info">{c.cancelled}</p>}
    </section>
  );
}

"use client";
import { useState } from "react";
import { overviewCopy as c, cleanupCopy, statusCopy } from "../copy/zh-CN.ts";
import { cleanErrorText } from "../ui/error-text.ts";
import { InlineNotice } from "../ui/InlineNotice.tsx";
import { PageSkeleton, Skeleton } from "../ui/Skeleton.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import { OverviewChapters } from "./overview/OverviewChapters.tsx";
import { OverviewStartChapter } from "./overview/OverviewStartChapter.tsx";
import {
  chapterNumber,
  explainReadiness,
  groupChapterRuns,
  type OverviewRun,
  overviewProgress,
  type Readiness,
  runHref,
} from "./overview/overview-data.ts";
import { useOverviewData } from "./overview/useOverviewData.ts";
import { useProjectDecisionContext } from "./project/ProjectDecisions.tsx";
import { SafeMarkdown } from "./SafeMarkdown.tsx";

export function ProjectHome({ id }: { id: string }) {
  const { previews, loading, refresh, revision } = useProjectDecisionContext();
  const { readiness, runs, heading, error } = useOverviewData(id, revision);
  const groups = groupChapterRuns(runs ?? []);
  const latest = groups[0]?.[0];
  const [writing, setWriting] = useState(false);
  const root = `/projects/${encodeURIComponent(id)}`;
  const ideation = `${root}/ideation`;
  const compile = `${ideation}?compile=1`;
  const progress =
    readiness && runs ? overviewProgress(readiness, latest?.status) : undefined;
  const nextChapter =
    Math.max(
      0,
      ...groups.map(([row]) => Number(row?.chapter)).filter(Number.isFinite),
    ) + 1;
  const waitingForDecisions = loading || (!runs && !error);
  const currentLink =
    progress?.action === "ideation"
      ? ideation
      : progress?.action === "compile"
        ? compile
        : latest && runHref(root, latest.id, progress?.action === "memory");
  const pending = groups
    .flat()
    .filter(
      ({ status }) =>
        status === "AWAITING_CANDIDATE_APPROVAL" ||
        status === "AWAITING_MEMORY_APPROVAL",
    );
  if (!readiness && !runs) {
    return (
      <main className="page-content overview-page" aria-label={c.title}>
        {error ? (
          <InlineNotice
            message={statusCopy.overviewFailed}
            onAction={refresh}
          />
        ) : (
          <PageSkeleton page="overview" />
        )}
      </main>
    );
  }
  return (
    <main className="page-content overview-page" aria-label={c.title}>
      {error && (
        <InlineNotice message={statusCopy.overviewFailed} onAction={refresh} />
      )}
      <div className="overview-columns">
        <div className="overview-column">
          <section
            className="overview-panel"
            aria-labelledby="overview-journey"
          >
            <h1 id="overview-journey">
              {latest
                ? c.journeyTitle(chapterNumber(latest.chapter))
                : c.beforeFirstChapter}
            </h1>
            {progress ? (
              <>
                <ol className="overview-steps">
                  {c.steps.map(({ title, description, done }, index) => {
                    const step = index + 1;
                    const state =
                      progress.step === "done" || step < progress.step
                        ? "done"
                        : step === progress.step
                          ? "current"
                          : "later";
                    return (
                      <li
                        key={title}
                        data-step-state={state}
                        aria-current={state === "current" ? "step" : undefined}
                      >
                        <span
                          className="overview-step-number"
                          aria-hidden="true"
                        >
                          {state === "done" ? "✓" : step}
                        </span>
                        <div>
                          <h3>{title}</h3>
                          <p>{state === "done" ? done : description}</p>
                        </div>
                        {state === "current" && currentLink && (
                          <a
                            className="ui-btn ui-btn-primary"
                            href={currentLink}
                          >
                            {c.actions[progress.action]}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {progress.step === "done" && nextChapter <= 9999 && (
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary"
                    onClick={() => setWriting(true)}
                  >
                    {c.actions.next}
                  </button>
                )}
              </>
            ) : null}
          </section>
          <OverviewReadiness
            readiness={readiness}
            ideation={ideation}
            compile={compile}
          />
          {readiness?.ready && runs && !latest && (
            <a
              className="ui-btn ui-btn-ghost overview-writing-link"
              href={`${root}/chapters`}
            >
              {c.openWriting}
            </a>
          )}
        </div>
        <div className="overview-column">
          <section
            id="decisions"
            className="overview-panel"
            aria-labelledby="overview-decisions"
            aria-busy={waitingForDecisions}
          >
            <h2 id="overview-decisions">{c.decisions}</h2>
            {pending.length || previews.length ? (
              <ul className="overview-decisions-list">
                {pending.map((run) => {
                  const memory = run.status === "AWAITING_MEMORY_APPROVAL";
                  const copy = memory ? c.chapterMemory : c.candidate;
                  return (
                    <Decision
                      key={run.id}
                      {...copy}
                      href={runHref(root, run.id, memory)}
                      label={runLabel(run, heading)}
                    />
                  );
                })}
                {previews.map(({ session, preview }) => {
                  const query = new URLSearchParams({
                    session: session.id,
                    preview: preview.id,
                  });
                  return (
                    <Decision
                      key={preview.id}
                      {...c.previews[preview.kind]}
                      href={`${ideation}?${query}`}
                      label={preview.summary}
                    />
                  );
                })}
              </ul>
            ) : waitingForDecisions ? (
              <Skeleton />
            ) : (
              <p className="overview-muted">
                {!runs ? c.loadFailed : c.emptyDecisions}
              </p>
            )}
          </section>
          <OverviewChapters
            groups={groups}
            heading={heading}
            root={root}
            emptyMessage={runs ? c.emptyRuns : error ? c.loadFailed : c.loading}
          />
        </div>
      </div>
      {writing && (
        <OverviewStartChapter
          root={root}
          initial={nextChapter}
          close={() => setWriting(false)}
        />
      )}
    </main>
  );
}

type Heading = { runId: string; title: string };

function runLabel(run: OverviewRun, heading?: Heading) {
  const chapter = chapterNumber(run.chapter);
  return heading?.runId === run.id
    ? c.chapterWithTitle(chapter, heading.title)
    : c.chapter(chapter);
}

function Decision({
  href,
  title,
  description,
  label,
}: {
  href: string;
  title: string;
  description: string;
  label: string;
}) {
  return (
    <li>
      <a href={href}>
        <span>{title}</span>
        <strong>
          <SafeMarkdown plain inline content={label} />
        </strong>
        <p>{description}</p>
      </a>
    </li>
  );
}

function OverviewReadiness({
  readiness,
  ideation,
  compile,
}: {
  readiness: Readiness | undefined;
  ideation: string;
  compile: string;
}) {
  const errors = readiness?.errors ?? [];
  const first = errors.slice(0, 5);
  const remaining = errors.slice(first.length);
  return (
    <section className="overview-panel" aria-labelledby="overview-readiness">
      <header className="overview-panel-heading">
        <h2 id="overview-readiness">{c.readinessHeading}</h2>
        {readiness && (
          <StatusBadge tone={readiness.ready ? "ok" : "decide"}>
            {readiness.ready
              ? c.ready
              : readiness.errors.length
                ? c.missing(readiness.errors.length)
                : c.unresolved}
          </StatusBadge>
        )}
      </header>
      {readiness && !readiness.ready && (
        <>
          <ReadinessChecks
            errors={first}
            ideation={ideation}
            compile={compile}
          />
          {remaining.length > 0 && (
            <details className="overview-details">
              <summary>
                {cleanupCopy.remainingReadiness(remaining.length)}
              </summary>
              <ReadinessChecks
                errors={remaining}
                ideation={ideation}
                compile={compile}
              />
            </details>
          )}
        </>
      )}
      <p className="overview-muted">{c.readinessHint}</p>
    </section>
  );
}

function ReadinessChecks({
  errors,
  ideation,
  compile,
}: {
  errors: readonly string[];
  ideation: string;
  compile: string;
}) {
  const issues = [];
  const other = [];
  for (const error of errors) {
    const issue = explainReadiness(error);
    if (issue) issues.push({ error, ...issue });
    else other.push(error);
  }
  return (
    <>
      {issues.length > 0 && (
        <ul className="overview-checks">
          {issues.map(({ error, message, destination }, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: The readiness API can emit the same reason more than once.
            <li key={`${index}-${error}`}>
              <span>{message}</span>
              <a href={destination === "compile" ? compile : ideation}>
                {c.fill}
              </a>
            </li>
          ))}
        </ul>
      )}
      {other.length > 0 && (
        <details className="overview-details">
          <summary>{c.otherChecks}</summary>
          <ul>
            {other.map((message, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Diagnostic messages may be repeated.
              <li key={`${index}-${message}`}>
                <SafeMarkdown plain inline content={cleanErrorText(message)} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

import {
  overviewCopy as c,
  chapterCopy,
  runStatus,
  runStatusTone,
} from "../../copy/zh-CN.ts";
import { StatusBadge } from "../../ui/StatusBadge.tsx";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { chapterNumber, type OverviewRun, runHref } from "./overview-data.ts";

type Row = { run: OverviewRun; attempt: number };

export function OverviewChapters({
  groups,
  heading,
  root,
  emptyMessage,
}: {
  groups: readonly OverviewRun[][];
  heading: { runId: string; title: string } | undefined;
  root: string;
  emptyMessage: string;
}) {
  const newest = groups.flatMap(([run, ...remaining]) =>
    run ? [{ run, attempt: remaining.length + 1 }] : [],
  );
  const older = groups.flatMap((rows) =>
    rows
      .slice(1)
      .map((run, index) => ({ run, attempt: rows.length - 1 - index })),
  );
  return (
    <section className="overview-panel" aria-labelledby="overview-chapters">
      <h2 id="overview-chapters">{c.chapters}</h2>
      {newest.length ? (
        <>
          <ChapterTable rows={newest} heading={heading} root={root} />
          {older.length > 0 && (
            <details className="overview-details overview-earlier-runs">
              <summary>{c.allRuns}</summary>
              <ChapterTable rows={older} root={root} label={c.olderRuns} />
            </details>
          )}
        </>
      ) : (
        <p className="overview-muted">{emptyMessage}</p>
      )}
    </section>
  );
}

function ChapterTable({
  rows,
  heading,
  root,
  label,
}: {
  rows: readonly Row[];
  heading?: { runId: string; title: string } | undefined;
  root: string;
  label?: string;
}) {
  return (
    <table className="overview-run-table" aria-label={label}>
      <thead>
        <tr>
          <th scope="col">{c.chapters}</th>
          <th scope="col">{c.lastRun}</th>
          <th scope="col">{c.status}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ run, attempt }) => (
          <tr key={run.id}>
            <th scope="row">
              <a href={runHref(root, run.id)}>
                <SafeMarkdown
                  inline
                  plain
                  content={
                    heading?.runId === run.id
                      ? c.chapterWithTitle(
                          chapterNumber(run.chapter),
                          heading.title,
                        )
                      : c.chapter(chapterNumber(run.chapter))
                  }
                />
              </a>
            </th>
            <td>{chapterCopy.attempt(attempt)}</td>
            <td>
              <StatusBadge tone={runStatusTone[run.status] ?? "stop"}>
                {runStatus[run.status] ?? chapterCopy.unknownStatus}
              </StatusBadge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

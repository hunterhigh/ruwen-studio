import type { RunStatus } from "@ruwen/pipeline";
import { overviewCopy as c } from "../../copy/zh-CN.ts";
import { chapterRuns, type RunSummary } from "../chapter/runs.ts";

export interface Readiness {
  ready: boolean;
  errors: readonly string[];
}

export function explainReadiness(error: string) {
  for (const rule of c.readinessRules) {
    const match = rule.pattern.exec(error);
    if (!match) continue;
    const key = match[1];
    const name = key && Object.hasOwn(c.names, key) ? c.names[key] : undefined;
    return {
      message: c.readinessMessages[rule.message](name),
      destination: rule.destination,
    };
  }
}

type Progress = {
  step: 1 | 2 | 3 | 4 | 5 | "done";
  action: keyof typeof c.actions;
};

const preparation = { step: 1, action: "ideation" } as const;
const writing = { step: 3, action: "progress" } as const;
const stopped = { step: 3, action: "reason" } as const;
const memory = { step: 5, action: "memory" } as const;
const statuses: Record<RunStatus, Progress> = {
  REQUESTED: writing,
  READINESS_OK: writing,
  PACKET_COMPILED: writing,
  AUTHOR_DONE: writing,
  READER_DONE: writing,
  EDITOR_DONE: writing,
  PLOT_CHECKED: writing,
  REALITY_CHECKED: writing,
  AWAITING_CANDIDATE_APPROVAL: { step: 4, action: "review" },
  CANDIDATE_APPROVED: memory,
  MEMORY_PREVIEW_READY: memory,
  AWAITING_MEMORY_APPROVAL: memory,
  MEMORY_COMMITTED: memory,
  DONE: { step: "done", action: "next" },
  RETURNED: stopped,
  FAILED_PRECONDITION: stopped,
  FAILED: stopped,
  CANCELLED: stopped,
};

export function overviewProgress(
  readiness: Readiness,
  status?: RunStatus,
): Progress {
  const projectionOnly =
    readiness.errors.length > 0 &&
    readiness.errors.every(
      (error) => explainReadiness(error)?.destination === "compile",
    );
  if (!readiness.ready)
    return projectionOnly ? { step: 2, action: "compile" } : preparation;
  if (status) return statuses[status] ?? stopped;
  return projectionOnly ? { step: 2, action: "compile" } : preparation;
}

export type OverviewRun = RunSummary & { chapter: string };
export const chapterNumber = (chapter: string) =>
  /^\d+$/.test(chapter) ? String(Number(chapter)) : chapter;

/** The runs API sorts by creation time, so the first attempt in each group is the newest. */
export function groupChapterRuns(rows: readonly RunSummary[]) {
  const groups = new Map<string, OverviewRun[]>();
  for (const run of chapterRuns(rows)) {
    const key = chapterNumber(run.chapter);
    const previous = groups.get(key);
    if (previous) previous.push(run);
    else groups.set(key, [run]);
  }
  return [...groups.values()];
}

/** Only a clear heading at the start of the latest manuscript supplies a chapter title. */
export function chapterHeading(prose: string | undefined) {
  const heading = /^\s*# +([^\r\n]+)\r?$/m.exec(
    prose?.trimStart().split("\n")[0] ?? "",
  )?.[1];
  return (
    heading
      ?.replace(
        /^第\s*[0-9一二三四五六七八九十百千零两]+\s*章(?:[\s：:·—-]*)/,
        "",
      )
      .trim() || undefined
  );
}

export function runHref(root: string, id: string, memory = false) {
  const query = new URLSearchParams({ run: id });
  if (memory) query.set("view", "memory");
  return `${root}/chapters?${query}`;
}

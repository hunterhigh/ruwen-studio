import type { RunStatus } from "@ruwen/pipeline";

export interface RunSummary {
  id: string;
  kind: string;
  chapter: string | null;
  status: RunStatus;
  created_at: string;
}

/** Keep the API's newest-first order. Compilation jobs can also have a chapter number. */
export function chapterRuns<T extends Pick<RunSummary, "kind" | "chapter">>(
  rows: readonly T[],
): (T & { chapter: string })[] {
  return rows.filter(
    (row): row is T & { chapter: string } =>
      row.kind === "chapter_run" &&
      typeof row.chapter === "string" &&
      row.chapter.trim().length > 0,
  );
}

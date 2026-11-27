"use client";
import { useEffect, useState } from "react";
import { chapterRuns, type RunSummary } from "../chapter/runs.ts";
import { request } from "../client.ts";
import { chapterHeading, type Readiness } from "./overview-data.ts";

type Snapshot = {
  id: string;
  readiness?: Readiness | undefined;
  runs?: RunSummary[] | undefined;
  heading?: { runId: string; title: string } | undefined;
  error: boolean;
};

export function useOverviewData(id: string, revision: number) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ id, error: false });
  // biome-ignore lint/correctness/useExhaustiveDependencies: The shared decision revision requests a fresh overview read.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const root = `/api/projects/${encodeURIComponent(id)}`;
    void Promise.allSettled([
      request<{ readiness: Readiness }>(root, { signal }),
      request<RunSummary[]>(`${root}/runs`, { signal }),
    ]).then(async ([project, runs]) => {
      if (signal.aborted) return;
      setSnapshot((before) => {
        const current = before.id === id ? before : undefined;
        return {
          id,
          readiness:
            project.status === "fulfilled"
              ? project.value.readiness
              : current?.readiness,
          runs: runs.status === "fulfilled" ? runs.value : current?.runs,
          heading: current?.heading,
          error: project.status === "rejected" || runs.status === "rejected",
        };
      });
      const latest = runs.status === "fulfilled" && chapterRuns(runs.value)[0];
      if (!latest) return;
      const detail = await request<{ prose?: string }>(
        `/api/runs/${encodeURIComponent(latest.id)}`,
        { signal },
      ).catch(() => undefined);
      if (signal.aborted) return;
      const title = chapterHeading(detail?.prose);
      setSnapshot((before) => ({
        ...before,
        heading: title ? { runId: latest.id, title } : undefined,
      }));
    });
    return () => controller.abort();
  }, [id, revision]);
  return snapshot.id === id ? snapshot : { id, error: false };
}

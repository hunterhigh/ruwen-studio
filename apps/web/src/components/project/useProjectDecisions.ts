"use client";
import type {
  IdeationPreviewV1_2 as IdeationPreview,
  IdeationSession,
} from "@ruwen/pipeline";
import { useEffect, useReducer, useRef, useState } from "react";
import { request } from "../client.ts";
import { allIdeationPages, createIdeationClient } from "../ideation/client.ts";

export interface DecisionProject {
  id: string;
  title: string;
  pending: number;
}
export interface PendingIdeationDecision {
  session: IdeationSession;
  preview: IdeationPreview;
}

/** Both collections are cursor-paged. Sessions arrive oldest first, not newest first. */
export async function loadIdeationDecisions(projectId: string) {
  const client = createIdeationClient(projectId);
  try {
    const sessions = await allIdeationPages((after) =>
      client.api.listIdeationSessions({
        ...(after ? { after } : {}),
        limit: 100,
      }),
    );
    if (!sessions.ok) return [];
    const recent = [...sessions.value]
      .reverse()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10);
    const pages = await Promise.all(
      recent.map(async (session) => {
        const previews = await allIdeationPages((after) =>
          client.api.listPreviews({
            sessionId: session.id,
            ...(after ? { after } : {}),
            limit: 100,
          }),
        );
        if (!previews.ok) throw new Error("Ideation decisions unavailable");
        return previews.value
          .filter((preview) => preview.status === "pending")
          .map((preview) => ({ session, preview }));
      }),
    );
    return pages.flat();
  } catch {
    // A partial count would be misleading. Fall back to chapter pending only.
    return [];
  } finally {
    client.dispose();
  }
}

/** Read-only aggregation shared by the project bar and the later overview block. */
export function useProjectDecisions(projectId: string) {
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const [loading, setLoading] = useState(true);
  const reading = useRef(true);
  const [snapshot, setSnapshot] = useState<{
    projectId: string;
    project: DecisionProject | undefined;
    previews: PendingIdeationDecision[];
  }>({ projectId, project: undefined, previews: [] });
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision explicitly requests a fresh read after caller refresh, focus or polling.
  useEffect(() => {
    let active = true;
    reading.current = true;
    setLoading(true);
    const chapters = request<DecisionProject[]>("/api/projects")
      .then((projects) => {
        if (!active) return;
        const project = projects.find((item) => item.id === projectId);
        setSnapshot((previous) => ({
          projectId,
          project,
          previews: previous.projectId === projectId ? previous.previews : [],
        }));
      })
      .catch(() => {
        // Keep the last known chapter count during a temporary transport failure.
      });
    const ideation = loadIdeationDecisions(projectId).then((previews) => {
      if (!active) return;
      setSnapshot((previous) => ({
        projectId,
        project:
          previous.projectId === projectId ? previous.project : undefined,
        previews,
      }));
    });
    void Promise.all([chapters, ideation]).then(() => {
      if (active) {
        reading.current = false;
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [projectId, revision]);
  useEffect(() => {
    const visibleRefresh = () => {
      if (document.visibilityState === "visible" && !reading.current) refresh();
    };
    const interval = window.setInterval(visibleRefresh, 15000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, []);
  const project =
    snapshot.projectId === projectId ? snapshot.project : undefined;
  const previews = snapshot.projectId === projectId ? snapshot.previews : [];
  const chapterPending = project?.pending ?? 0;
  return {
    project,
    chapterPending,
    previews,
    count: chapterPending + previews.length,
    loading: loading || snapshot.projectId !== projectId,
    refresh,
  };
}

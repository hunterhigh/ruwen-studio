"use client";
import type {
  IdeationPreviewV1_2 as IdeationPreview,
  IdeationSession,
} from "@ruwen/pipeline";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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

type Visibility = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
> & {
  readonly visibilityState: DocumentVisibilityState;
};
type BrowserClock = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
> & {
  setInterval: (callback: () => void, delayMs: number) => number;
  clearInterval: (timer: number) => void;
};

/** Keep one foreground timer, with an immediate refresh when the page becomes visible. */
export function observeDecisionPolling(
  screen: Visibility,
  browser: BrowserClock,
  refresh: () => void,
  isReading: () => boolean,
) {
  let timer: number | undefined;
  const clear = () => {
    if (timer === undefined) return;
    browser.clearInterval(timer);
    timer = undefined;
  };
  const refreshIfIdle = () => {
    if (screen.visibilityState === "visible" && !isReading()) refresh();
  };
  const schedule = () => {
    timer = browser.setInterval(refreshIfIdle, 60_000);
  };
  const visibilityChanged = () => {
    if (screen.visibilityState !== "visible") {
      clear();
    } else if (timer === undefined) {
      refresh();
      schedule();
    }
  };
  if (screen.visibilityState === "visible") schedule();
  screen.addEventListener("visibilitychange", visibilityChanged);
  browser.addEventListener("focus", refreshIfIdle);
  return () => {
    clear();
    screen.removeEventListener("visibilitychange", visibilityChanged);
    browser.removeEventListener("focus", refreshIfIdle);
  };
}

/** Read-only aggregation shared by the project bar and the overview. */
export function useProjectDecisions(projectId: string) {
  const [revision, requestRefresh] = useReducer(
    (value: number) => value + 1,
    0,
  );
  const [loading, setLoading] = useState(true);
  const reading = useRef(true);
  const refresh = useCallback(() => {
    reading.current = true;
    requestRefresh();
  }, []);
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
  useEffect(
    () =>
      observeDecisionPolling(document, window, refresh, () => reading.current),
    [refresh],
  );
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
    revision,
  };
}

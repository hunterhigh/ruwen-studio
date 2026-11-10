import type {
  IdeationCursor,
  IdeationEvent,
  IdeationProjectId,
  IdeationRunId,
  IdeationSafeText,
  IdeationSession,
  IdeationSessionId,
} from "@ruwen/pipeline";

/** Local, disposable UI fixtures. These casts certify no server content or authority. */
export function createIdeationDemo(projectId: string) {
  const sessions: IdeationSession[] = ["北岸冬信", "渡河之前"].map(
    (title, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}` as IdeationSessionId,
      projectId: projectId as IdeationProjectId,
      title,
      status: "open",
      revision: 0,
      currentTurnId: null,
      capabilities: { externalSearch: false, modelMode: "faux" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );
  let cursor = 0n;
  const listeners = new Set<(event: IdeationEvent) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const runs: { sessionId: IdeationSessionId; runId: IdeationRunId }[] = [];
  function attempt(sessionId: IdeationSessionId, refusal: boolean) {
    const runId = crypto.randomUUID() as IdeationRunId;
    runs.push({ sessionId, runId });
    const base = {
      version: 1 as const,
      projectId: projectId as IdeationProjectId,
      sessionId,
      runId,
      role: "chuangyi-xietiaoyuan" as const,
    };
    const emit = (
      data:
        | { type: "delta"; text: IdeationSafeText }
        | { type: "reset"; reason: "security_refusal" | "format_correction" },
    ) => {
      const event: IdeationEvent = {
        ...base,
        ...data,
        id: String(++cursor) as IdeationCursor,
        createdAt: new Date().toISOString(),
      };
      for (const listener of listeners) listener(event);
    };
    const later = (ms: number, callback: () => void) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        callback();
      }, ms);
      timers.add(timer);
    };
    emit({ type: "delta", text: "尚未完成的旧尝试。" as IdeationSafeText });
    later(900, () =>
      emit({
        type: "reset",
        reason: refusal ? "security_refusal" : "format_correction",
      }),
    );
    later(1800, () =>
      emit({
        type: "delta",
        text: (refusal
          ? "这部分属于平台内部设置，我没法提供。我们继续聊你的故事吧。"
          : "更正后的思路：让渡河的决定留在人物手中。") as IdeationSafeText,
      }),
    );
    return runId;
  }
  return {
    sessions,
    runs,
    attempt,
    subscribe(listener: (event: IdeationEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
    },
  };
}

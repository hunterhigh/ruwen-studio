import type {
  IdeationActor,
  IdeationCursor,
  IdeationError,
  IdeationEventV1_2 as IdeationEvent,
  IdeationPage,
  IdeationRequestId,
  IdeationResult,
  IdeationServiceV1_2 as IdeationService,
  IdeationSessionId,
} from "@ruwen/pipeline";
import { ApiError, request } from "../client.ts";
import { errorCopy } from "./copy.ts";

type ClientMethods = Omit<IdeationService, "listIdeationEvents">;
export type IdeationClient = {
  [K in keyof ClientMethods]: ClientMethods[K] extends (
    actor: IdeationActor,
    ...args: infer A
  ) => infer R
    ? (...args: A) => R
    : never;
};
export const newRequestId = () => crypto.randomUUID() as IdeationRequestId;
export async function allIdeationPages<T>(
  load: (after?: IdeationCursor) => Promise<IdeationResult<IdeationPage<T>>>,
) {
  const items: T[] = [];
  let after: IdeationCursor | undefined;
  for (;;) {
    const page = await load(after);
    if (!page.ok) return page;
    items.push(...page.value.items);
    if (!page.value.nextCursor) return { ok: true, value: items } as const;
    if (after === page.value.nextCursor) throw new Error("Non-advancing page");
    after = page.value.nextCursor;
  }
}
export function createIdeationClient(projectId: string) {
  const root = `/api/projects/${encodeURIComponent(projectId)}/ideation`;
  async function send<T>(
    path: string,
    method: string,
    input: object,
    locator?: string,
  ): Promise<IdeationResult<T>> {
    const data = Object.fromEntries(
      Object.entries(input).filter(
        ([key, value]) => key !== locator && value !== undefined,
      ),
    );
    const query = new URLSearchParams(
      Object.entries(data).map(([key, value]) => [key, String(value)]),
    );
    try {
      return await request<IdeationResult<T>>(
        root + path + (method === "GET" && query.size ? `?${query}` : ""),
        { method, ...(method === "GET" ? {} : { body: JSON.stringify(data) }) },
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.details &&
        typeof error.details === "object" &&
        "ok" in error.details &&
        error.details.ok === false
      )
        return error.details as IdeationResult<T>;
      return {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: errorCopy.INTERNAL_ERROR as IdeationError["message"],
          retryable: false,
          traceId: crypto.randomUUID(),
          issues: [],
        },
      };
    }
  }
  const api: IdeationClient = {
    createIdeationSession: (r) => send("/sessions", "POST", r),
    listIdeationSessions: (r) => send("/sessions", "GET", r),
    getIdeationSession: (r) =>
      send(`/sessions/${r.sessionId}`, "GET", r, "sessionId"),
    closeIdeationSession: (r) =>
      send(`/sessions/${r.sessionId}/close`, "POST", r, "sessionId"),
    listIdeationMessages: (r) =>
      send(`/sessions/${r.sessionId}/messages`, "GET", r, "sessionId"),
    sendIdeationMessage: (r) =>
      send(`/sessions/${r.sessionId}/messages`, "POST", r, "sessionId"),
    listPreviews: (r) =>
      send(`/sessions/${r.sessionId}/previews`, "GET", r, "sessionId"),
    getPreview: (r) => send(`/previews/${r.previewId}`, "GET", r, "previewId"),
    approvePreview: (r) =>
      send(`/previews/${r.previewId}/approve`, "POST", r, "previewId"),
    rejectPreview: (r) =>
      send(`/previews/${r.previewId}/reject`, "POST", r, "previewId"),
    revisePreview: (r) =>
      send(`/previews/${r.previewId}/revise`, "POST", r, "previewId"),
    activateExpression: (r) =>
      send(
        `/previews/${r.previewId}/activate-expression`,
        "POST",
        r,
        "previewId",
      ),
    requestIdeationCompilation: (r) =>
      send(`/sessions/${r.sessionId}/compile`, "POST", r, "sessionId"),
    listIdeationTasks: (r) =>
      send(`/sessions/${r.sessionId}/tasks`, "GET", r, "sessionId"),
    getIdeationTask: (r) => send(`/tasks/${r.taskId}`, "GET", r, "taskId"),
    cancelIdeationTask: (r) =>
      send(`/tasks/${r.taskId}/cancel`, "POST", r, "taskId"),
    getIdeationApproval: (r) =>
      send(`/decisions/${r.decisionId}`, "GET", r, "decisionId"),
    createVerbatimPreview: (r) =>
      send(
        `/messages/${r.messageId}/verbatim-previews`,
        "POST",
        r,
        "messageId",
      ),
  };
  const active = new Set<EventSource>(),
    cursors = new Map<string, IdeationCursor>();
  function subscribe(
    sessionId: IdeationSessionId,
    listener: (event: IdeationEvent) => void,
  ) {
    const after = cursors.get(sessionId) ?? "0";
    const source = new EventSource(
      `${root}/sessions/${sessionId}/events?after=${after}`,
    );
    active.add(source);
    for (const type of [
      "delta",
      "reset",
      "message_changed",
      "task_changed",
      "preview_changed",
      "approval_committed",
      "error",
    ]) {
      source.addEventListener(type, (frame) => {
        if (!(frame instanceof MessageEvent)) return;
        try {
          const event = JSON.parse(frame.data) as IdeationEvent;
          if (
            event.version !== 1 ||
            event.projectId !== projectId ||
            event.sessionId !== sessionId ||
            event.type !== type ||
            !/^\d+$/.test(event.id)
          )
            return;
          if (BigInt(event.id) <= BigInt(cursors.get(sessionId) ?? "0")) return;
          cursors.set(sessionId, event.id);
          listener(event);
        } catch {
          /* Native reconnect resumes from its acknowledged cursor; no model retry. */
        }
      });
    }
    return () => {
      source.close();
      active.delete(source);
    };
  }
  return {
    api,
    subscribe,
    dispose() {
      for (const source of active) source.close();
      active.clear();
    },
  };
}

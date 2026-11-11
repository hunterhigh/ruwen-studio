import { randomUUID } from "node:crypto";
import type {
  IdeationActor,
  IdeationErrorCode,
  IdeationResult,
  IdeationService,
  IdeationSessionId,
} from "@ruwen/pipeline";
import { ideationSse } from "@ruwen/pipeline";
import type { RouteDefinition } from "./api.ts";
import { requireOwnership } from "./ownership.ts";
import type { WebServices } from "./services.ts";

type Endpoint = {
  method: string;
  path: string;
  operation: keyof IdeationService;
  locator?: "sessionId" | "previewId" | "taskId" | "decisionId";
  accepted?: boolean;
};
export const IDEATION_ENDPOINTS: readonly Endpoint[] = [
  { method: "POST", path: "/sessions", operation: "createIdeationSession" },
  { method: "GET", path: "/sessions", operation: "listIdeationSessions" },
  {
    method: "GET",
    path: "/sessions/:sessionId",
    operation: "getIdeationSession",
    locator: "sessionId",
  },
  {
    method: "POST",
    path: "/sessions/:sessionId/close",
    operation: "closeIdeationSession",
    locator: "sessionId",
  },
  {
    method: "GET",
    path: "/sessions/:sessionId/messages",
    operation: "listIdeationMessages",
    locator: "sessionId",
  },
  {
    method: "POST",
    path: "/sessions/:sessionId/messages",
    operation: "sendIdeationMessage",
    locator: "sessionId",
    accepted: true,
  },
  {
    method: "GET",
    path: "/sessions/:sessionId/previews",
    operation: "listPreviews",
    locator: "sessionId",
  },
  {
    method: "GET",
    path: "/previews/:previewId",
    operation: "getPreview",
    locator: "previewId",
  },
  {
    method: "POST",
    path: "/previews/:previewId/approve",
    operation: "approvePreview",
    locator: "previewId",
  },
  {
    method: "POST",
    path: "/previews/:previewId/reject",
    operation: "rejectPreview",
    locator: "previewId",
  },
  {
    method: "POST",
    path: "/previews/:previewId/revise",
    operation: "revisePreview",
    locator: "previewId",
    accepted: true,
  },
  {
    method: "POST",
    path: "/previews/:previewId/activate-expression",
    operation: "activateExpression",
    locator: "previewId",
  },
  {
    method: "POST",
    path: "/sessions/:sessionId/compile",
    operation: "requestIdeationCompilation",
    locator: "sessionId",
    accepted: true,
  },
  {
    method: "GET",
    path: "/sessions/:sessionId/tasks",
    operation: "listIdeationTasks",
    locator: "sessionId",
  },
  {
    method: "GET",
    path: "/tasks/:taskId",
    operation: "getIdeationTask",
    locator: "taskId",
  },
  {
    method: "POST",
    path: "/tasks/:taskId/cancel",
    operation: "cancelIdeationTask",
    locator: "taskId",
  },
  {
    method: "GET",
    path: "/decisions/:decisionId",
    operation: "getIdeationApproval",
    locator: "decisionId",
  },
  {
    method: "GET",
    path: "/sessions/:sessionId/events",
    operation: "listIdeationEvents",
    locator: "sessionId",
  },
];
export const IDEATION_ROUTES: readonly RouteDefinition[] =
  IDEATION_ENDPOINTS.map((e) => ({
    method: e.method,
    pattern: `/api/projects/:projectId/ideation${e.path}`,
    resource: "projectId",
    foreignCase: `foreign ideation ${e.operation}`,
    resourceParams: e.locator ? ["projectId", e.locator] : ["projectId"],
    ideation: e.operation,
  }));
export const ideationHttpStatus = (code: IdeationErrorCode): number =>
  (
    ({
      UNAUTHENTICATED: 401,
      NOT_FOUND: 404,
      CSRF_INVALID: 403,
      BILLING_DISABLED: 403,
      INVALID_ARGUMENT: 400,
      INSUFFICIENT_CREDITS: 402,
      INPUT_LIMIT_EXCEEDED: 413,
      CREATION_CHECK_FAILED: 422,
      OUTPUT_BLOCKED: 422,
      ACCOUNT_FROZEN: 423,
      RATE_LIMITED: 429,
      PROVIDER_UNAVAILABLE: 503,
      INTERNAL_ERROR: 500,
    }) as Partial<Record<IdeationErrorCode, number>>
  )[code] ?? 409;
export function webIdeation(services: WebServices): IdeationService {
  services.ideation ??= services.worker.ideationService;
  return services.ideation;
}
export function ideationFailureResponse(code: IdeationErrorCode) {
  return Response.json(
    {
      ok: false,
      error: {
        code,
        message: "构思操作未完成，请核对状态后重试。",
        retryable: code === "PROVIDER_UNAVAILABLE",
        traceId: randomUUID(),
        issues: [],
      },
    },
    {
      status: ideationHttpStatus(code),
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function handleIdeation(
  request: Request,
  services: WebServices,
  userId: string,
  route: RouteDefinition,
  params: Record<string, string>,
  input: Record<string, unknown>,
) {
  const service = webIdeation(services),
    actor = { userId, projectId: params.projectId } as IdeationActor;
  if (route.ideation === "listIdeationEvents") {
    const result = await ideationSse(
      service,
      async () => {
        const session = await services.auth.api.getSession({
          headers: request.headers,
        });
        if (!session) return null;
        try {
          await requireOwnership(services.worker.db, session.user.id, {
            projectId: params.projectId ?? "",
            ideation: { sessionId: params.sessionId ?? "" },
          });
        } catch {
          return null;
        }
        return {
          userId: session.user.id,
          projectId: params.projectId,
        } as IdeationActor;
      },
      {
        sessionId: params.sessionId as IdeationSessionId,
        after: input.after as never,
        lastEventId: request.headers.get("last-event-id"),
        signal: request.signal,
      },
    );
    return result.ok
      ? result.value
      : Response.json(result, {
          status: ideationHttpStatus(result.error.code),
          headers: { "Cache-Control": "no-store" },
        });
  }
  const endpoint = IDEATION_ENDPOINTS.find(
    (e) => e.operation === route.ideation,
  );
  if (!endpoint) throw new Error("Unregistered ideation method");
  const data = {
    ...input,
    ...(endpoint.locator
      ? { [endpoint.locator]: params[endpoint.locator] }
      : {}),
  };
  // JSON is validated by the real contract service, including exact fields; no client identity is forwarded.
  const result: IdeationResult<unknown> = await service[endpoint.operation](
    actor,
    data as never,
  );
  return Response.json(result, {
    status: result.ok
      ? endpoint.accepted
        ? 202
        : 200
      : ideationHttpStatus(result.error.code),
    headers: { "Cache-Control": "no-store" },
  });
}

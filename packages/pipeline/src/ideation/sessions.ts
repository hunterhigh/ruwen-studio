import { createHash, randomUUID } from "node:crypto";
import type { SearchProvider } from "@ruwen/agents";
import { securityLimits } from "../../../../config/security.ts";
import type {
  IdeationActor,
  IdeationClosedSession,
  IdeationError,
  IdeationErrorCode,
  IdeationEvent,
  IdeationEventData,
  IdeationMessage,
  IdeationPage,
  IdeationPageRequest,
  IdeationResult,
  IdeationRunId,
  IdeationSafeText,
  IdeationSendMessage,
  IdeationService,
  IdeationSession,
  IdeationTask,
  RunStartErrorCode,
} from "./contract.ts";
import type { IdeationStore, IdeationTransaction } from "./store.ts";

export const ideationUuid = {
  test: (value: unknown): value is string =>
    typeof value === "string" &&
    /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(value),
};
export class IdeationFailure extends Error {
  readonly code: IdeationErrorCode;
  constructor(code: IdeationErrorCode) {
    super(code);
    this.code = code;
  }
}
export function ideationFail(code: IdeationErrorCode): never {
  throw new IdeationFailure(code);
}
export function ideationError(code: IdeationErrorCode): IdeationError {
  // Fixed copy only; SQL/provider/validation exceptions and rejected values never cross this boundary.
  return {
    code,
    message: `构思操作未完成（${code}）。` as IdeationSafeText,
    retryable: code === "PROVIDER_UNAVAILABLE",
    traceId: randomUUID(),
    issues: [],
  };
}
export function ideationDigest(value: unknown) {
  const ordered = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordered)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, ordered(x)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(ordered(value)))
    .digest("hex");
}
export function exactIdeationRequest(request: object, fields: string[]) {
  if (Object.keys(request).some((key) => !fields.includes(key)))
    ideationFail("INVALID_ARGUMENT");
}
export function ideationPage(request: IdeationPageRequest) {
  if (
    request.after !== undefined &&
    (typeof request.after !== "string" ||
      !/^(0|[1-9]\d{0,18})$/.test(request.after))
  )
    ideationFail("INVALID_ARGUMENT");
  if (BigInt(request.after ?? "0") > 9223372036854775807n)
    ideationFail("INVALID_ARGUMENT");
  const limit = request.limit === undefined ? 50 : request.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    ideationFail("INVALID_ARGUMENT");
  return { after: request.after ?? "0", limit };
}
export function ideationText(
  text: unknown,
  max = securityLimits().chatChars,
): asserts text is string {
  if (typeof text !== "string" || !text.trim())
    ideationFail("INVALID_ARGUMENT");
  if (Array.from(text).length > max) ideationFail("INPUT_LIMIT_EXCEEDED");
}
export async function ownedSession(
  tx: IdeationTransaction,
  actor: IdeationActor,
  id: string,
) {
  if (!ideationUuid.test(id)) ideationFail("NOT_FOUND");
  const row = await tx.sql<{ session: IdeationSession; ordinal: string }>(
    `SELECT jsonb_build_object('id',id,'projectId',project_id,'title',title,'status',status,'revision',revision,'currentTurnId',current_turn_id,'createdAt',created_at,'updatedAt',updated_at) AS session,ordinal::text FROM ideation_sessions WHERE project_id=$1 AND id=$2 FOR UPDATE`,
    [actor.projectId, id],
  );
  if (!row.rows[0]) ideationFail("NOT_FOUND");
  return row.rows[0].session;
}
export async function appendIdeationEvent(
  tx: IdeationTransaction,
  actor: IdeationActor,
  sessionId: string,
  runId: string | null,
  data: IdeationEventData,
) {
  await tx.sql(
    "INSERT INTO ideation_events(project_id,session_id,run_id,data) VALUES($1,$2,$3,$4)",
    [actor.projectId, sessionId, runId, JSON.stringify(data)],
  );
}
export interface IdeationSessionOptions {
  search?: SearchProvider;
  queue?: string;
  modelMode: IdeationSession["capabilities"]["modelMode"];
  externalSearch?: boolean;
  /** Main thread supplies billing/freeze guards. Called after all ownership, inside acceptance transaction. */
  beforeRun?: (
    tx: IdeationTransaction,
    actor: IdeationActor,
    runId: IdeationRunId,
  ) => Promise<RunStartErrorCode | undefined>;
  /** Bind a reservation after the run row exists, in the same uncommitted acceptance transaction. */
  onRunAccepted?: (
    tx: IdeationTransaction,
    actor: IdeationActor,
    runId: IdeationRunId,
  ) => Promise<RunStartErrorCode | undefined>;
  onTaskTerminal?: (
    tx: IdeationTransaction,
    actor: IdeationActor,
    runId: IdeationRunId,
  ) => Promise<void>;
}
type SessionMethods = Pick<
  IdeationService,
  | "createIdeationSession"
  | "listIdeationSessions"
  | "getIdeationSession"
  | "closeIdeationSession"
  | "listIdeationMessages"
  | "sendIdeationMessage"
  | "listIdeationTasks"
  | "getIdeationTask"
  | "cancelIdeationTask"
  | "listIdeationEvents"
>;
export class IdeationSessions implements SessionMethods {
  readonly store: IdeationStore;
  readonly options: IdeationSessionOptions;
  constructor(store: IdeationStore, options: IdeationSessionOptions) {
    this.store = store;
    this.options = options;
  }
  async call<T>(
    actor: IdeationActor,
    operation: (tx: IdeationTransaction) => Promise<T>,
  ): Promise<IdeationResult<T>> {
    try {
      if (
        !ideationUuid.test(actor?.userId) ||
        !ideationUuid.test(actor?.projectId)
      )
        ideationFail("NOT_FOUND");
      return {
        ok: true,
        value: await this.store.transaction(actor, operation),
      };
    } catch (error) {
      return {
        ok: false,
        error: ideationError(
          error instanceof IdeationFailure
            ? error.code
            : error instanceof Error && error.name === "TenantAccessError"
              ? "NOT_FOUND"
              : "INTERNAL_ERROR",
        ),
      };
    }
  }
  capabilities(session: IdeationSession): IdeationSession {
    return {
      ...session,
      capabilities: {
        modelMode: this.options.modelMode,
        externalSearch: this.options.externalSearch === true,
      },
    };
  }
  async mutate<T>(
    tx: IdeationTransaction,
    actor: IdeationActor,
    operation: string,
    request: { readonly clientRequestId: string },
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!ideationUuid.test(request.clientRequestId))
      ideationFail("INVALID_ARGUMENT");
    const hash = ideationDigest(request);
    const row = await tx.sql<{ request_sha256: string; result: T }>(
      "SELECT request_sha256,result FROM ideation_requests WHERE user_id=$1 AND project_id=$2 AND operation=$3 AND request_id=$4",
      [actor.userId, actor.projectId, operation, request.clientRequestId],
    );
    if (row.rows[0]) {
      if (row.rows[0].request_sha256 !== hash)
        ideationFail("IDEMPOTENCY_CONFLICT");
      return row.rows[0].result;
    }
    const value = await fn();
    await tx.sql(
      "INSERT INTO ideation_requests(user_id,project_id,operation,request_id,request_sha256,result) VALUES($1,$2,$3,$4,$5,$6)",
      [
        actor.userId,
        actor.projectId,
        operation,
        request.clientRequestId,
        hash,
        JSON.stringify(value),
      ],
    );
    return value;
  }
  createIdeationSession: SessionMethods["createIdeationSession"] = (
    actor,
    request,
  ) =>
    this.call(actor, async (tx) => {
      exactIdeationRequest(request, ["clientRequestId", "title"]);
      if (request.title !== undefined) ideationText(request.title, 80);
      return this.mutate(tx, actor, "createSession", request, async () => {
        const row = await tx.sql<{ id: string }>(
          "INSERT INTO ideation_sessions(project_id,title) VALUES($1,$2) RETURNING id",
          [actor.projectId, request.title ?? ""],
        );
        return this.capabilities(
          await ownedSession(
            tx,
            actor,
            row.rows[0]?.id ?? ideationFail("INTERNAL_ERROR"),
          ),
        );
      });
    });
  listIdeationSessions: SessionMethods["listIdeationSessions"] = (
    actor,
    request,
  ) =>
    this.call(actor, async (tx) => {
      exactIdeationRequest(request, ["after", "limit", "status"]);
      const { after, limit } = ideationPage(request);
      if (
        request.status !== undefined &&
        !["open", "closed"].includes(request.status)
      )
        ideationFail("INVALID_ARGUMENT");
      const rows = await tx.sql<{ id: string; ordinal: string }>(
        "SELECT id,ordinal::text FROM ideation_sessions WHERE project_id=$1 AND ordinal>$2::bigint AND ($3::text IS NULL OR status=$3) ORDER BY ordinal LIMIT $4",
        [actor.projectId, after, request.status ?? null, limit + 1],
      );
      const items = [];
      for (const row of rows.rows.slice(0, limit))
        items.push(this.capabilities(await ownedSession(tx, actor, row.id)));
      return {
        items,
        nextCursor:
          rows.rows.length > limit
            ? (rows.rows.at(limit - 1)
                ?.ordinal as IdeationPage<IdeationSession>["nextCursor"])
            : null,
      };
    });
  getIdeationSession: SessionMethods["getIdeationSession"] = (actor, request) =>
    this.call(actor, async (tx) => {
      const session = await ownedSession(tx, actor, request.sessionId);
      exactIdeationRequest(request, ["sessionId"]);
      return this.capabilities(session);
    });
  closeIdeationSession: SessionMethods["closeIdeationSession"] = (
    actor,
    request,
  ) =>
    this.call(actor, async (tx) => {
      await ownedSession(tx, actor, request.sessionId);
      exactIdeationRequest(request, ["sessionId", "clientRequestId"]);
      return this.mutate(tx, actor, "closeSession", request, async () => {
        await tx.sql(
          "UPDATE ideation_sessions SET status='closed',updated_at=CASE WHEN status='open' THEN now() ELSE updated_at END WHERE id=$1 AND project_id=$2",
          [request.sessionId, actor.projectId],
        );
        return this.capabilities(
          await ownedSession(tx, actor, request.sessionId),
        ) as IdeationClosedSession;
      });
    });
  async guardRun(
    tx: IdeationTransaction,
    actor: IdeationActor,
    runId: IdeationRunId,
  ) {
    // Generic recording retains requests; coordinator wording must not become a tape snapshot.
    if (this.options.modelMode === "record")
      ideationFail("PRECONDITION_FAILED");
    if (!this.options.beforeRun && this.options.modelMode !== "faux")
      ideationFail("BILLING_DISABLED");
    const failure = await this.options.beforeRun?.(tx, actor, runId);
    if (failure) ideationFail(failure);
  }
  sendIdeationMessage: SessionMethods["sendIdeationMessage"] = (
    actor,
    request,
  ) =>
    this.call(actor, async (tx) => {
      const session = await ownedSession(tx, actor, request.sessionId);
      exactIdeationRequest(request, [
        "sessionId",
        "clientRequestId",
        "expectedSessionRevision",
        "content",
      ]);
      ideationText(request.content);
      if (
        !Number.isSafeInteger(request.expectedSessionRevision) ||
        request.expectedSessionRevision < 0
      )
        ideationFail("INVALID_ARGUMENT");
      return this.mutate(tx, actor, "sendMessage", request, async () => {
        return this.acceptMessage(tx, actor, session, request);
      });
    });
  async acceptMessage(
    tx: IdeationTransaction,
    actor: IdeationActor,
    session: IdeationSession,
    request: IdeationSendMessage,
  ) {
    if (session.status === "closed") ideationFail("SESSION_CLOSED");
    if (session.currentTurnId) ideationFail("TURN_IN_PROGRESS");
    if (session.revision !== request.expectedSessionRevision)
      ideationFail("PRECONDITION_FAILED");
    const turnId = randomUUID() as IdeationRunId,
      messageId = randomUUID() as IdeationMessage["id"],
      revision = session.revision + 1;
    await this.guardRun(tx, actor, turnId);
    await tx.sql(
      "INSERT INTO pipeline_runs(id,project_id,kind,status,request) VALUES($1,$2,'ideation_coordinator','QUEUED',$3)",
      [
        turnId,
        actor.projectId,
        JSON.stringify({
          sessionId: session.id,
          sessionRevision: revision,
        }),
      ],
    );
    await tx.sql(
      "INSERT INTO ideation_tasks(run_id,project_id,session_id,role,stage,session_revision) VALUES($1,$2,$3,'chuangyi-xietiaoyuan','coordinator',$4)",
      [turnId, actor.projectId, session.id, revision],
    );
    await tx.sql(
      "INSERT INTO ideation_messages(id,project_id,session_id,turn_id,role,content,session_revision) VALUES($1,$2,$3,$4,'user',$5,$6)",
      [
        messageId,
        actor.projectId,
        session.id,
        turnId,
        JSON.stringify(request.content),
        revision,
      ],
    );
    await tx.sql(
      "UPDATE ideation_sessions SET revision=$2,current_turn_id=$3,updated_at=now() WHERE id=$1",
      [session.id, revision, turnId],
    );
    await tx.sql(
      "INSERT INTO ideation_outbox(run_id,queue_name) VALUES($1,$2)",
      [turnId, this.options.queue ?? "ruwen-work"],
    );
    const reservationFailure = await this.options.onRunAccepted?.(
      tx,
      actor,
      turnId,
    );
    if (reservationFailure) ideationFail(reservationFailure);
    await appendIdeationEvent(tx, actor, session.id, turnId, {
      type: "message_changed",
      messageId,
      turnId,
      status: "complete",
    });
    await appendIdeationEvent(tx, actor, session.id, turnId, {
      type: "task_changed",
      taskId: turnId,
      status: "QUEUED",
    });
    return {
      sessionId: session.id,
      messageId,
      turnId,
      sessionRevision: revision,
    };
  }
  listIdeationMessages: SessionMethods["listIdeationMessages"] = (
    actor,
    request,
  ) =>
    this.call(actor, async (tx) => {
      await ownedSession(tx, actor, request.sessionId);
      exactIdeationRequest(request, ["sessionId", "after", "limit"]);
      const { after, limit } = ideationPage(request);
      const rows = await tx.sql<{ ordinal: string; message: IdeationMessage }>(
        `SELECT ordinal::text,jsonb_build_object('id',id,'projectId',project_id,'sessionId',session_id,'turnId',turn_id,'role',role,'content',content,'status',status,'createdAt',created_at) AS message FROM ideation_messages WHERE project_id=$1 AND session_id=$2 AND ordinal>$3::bigint AND role IN ('user','assistant') ORDER BY ordinal LIMIT $4`,
        [actor.projectId, request.sessionId, after, limit + 1],
      );
      return {
        items: rows.rows.slice(0, limit).map((r) => r.message),
        nextCursor:
          rows.rows.length > limit
            ? (rows.rows.at(limit - 1)
                ?.ordinal as IdeationPage<IdeationMessage>["nextCursor"])
            : null,
      };
    });
  async ownedTask(tx: IdeationTransaction, actor: IdeationActor, id: string) {
    if (!ideationUuid.test(id)) ideationFail("NOT_FOUND");
    const row = await tx.sql<{ task: IdeationTask }>(
      `SELECT jsonb_build_object('id',r.id,'projectId',r.project_id,'sessionId',t.session_id,'role',t.role,'stage',t.stage,'status',r.status,'sourcePreviewId',t.source_preview_id,'outputPreviewIds',t.output_preview_ids,'usage',jsonb_build_object('inputTokens',coalesce(u.i,0),'outputTokens',coalesce(u.o,0),'cacheReadTokens',coalesce(u.cr,0),'cacheWriteTokens',coalesce(u.cw,0),'costUsd',u.cost::text),'error',t.error,'createdAt',r.created_at,'finishedAt',r.finished_at) AS task FROM ideation_tasks t JOIN pipeline_runs r ON r.id=t.run_id AND r.project_id=t.project_id LEFT JOIN LATERAL (SELECT sum((x->>'input')::bigint) i,sum((x->>'output')::bigint) o,sum((x->>'cacheRead')::bigint) cr,sum((x->>'cacheWrite')::bigint) cw,(SELECT sum(cost_usd) FROM role_runs rr WHERE rr.run_id=r.id) cost FROM role_runs rr CROSS JOIN LATERAL jsonb_array_elements(rr.usage) x WHERE rr.run_id=r.id) u ON true WHERE t.run_id=$1 AND t.project_id=$2`,
      [id, actor.projectId],
    );
    if (!row.rows[0]) ideationFail("NOT_FOUND");
    await ownedSession(tx, actor, row.rows[0].task.sessionId);
    return row.rows[0].task;
  }
  getIdeationTask: SessionMethods["getIdeationTask"] = (actor, request) =>
    this.call(actor, async (tx) => {
      const task = await this.ownedTask(tx, actor, request.taskId);
      exactIdeationRequest(request, ["taskId"]);
      return task;
    });
  listIdeationTasks: SessionMethods["listIdeationTasks"] = (actor, request) =>
    this.call(actor, async (tx) => {
      await ownedSession(tx, actor, request.sessionId);
      exactIdeationRequest(request, ["sessionId", "after", "limit"]);
      const { after, limit } = ideationPage(request);
      const rows = await tx.sql<{ run_id: string; ordinal: string }>(
        "SELECT run_id,ordinal::text FROM ideation_tasks WHERE project_id=$1 AND session_id=$2 AND ordinal>$3::bigint ORDER BY ordinal LIMIT $4",
        [actor.projectId, request.sessionId, after, limit + 1],
      );
      const items = [];
      for (const row of rows.rows.slice(0, limit))
        items.push(await this.ownedTask(tx, actor, row.run_id));
      return {
        items,
        nextCursor:
          rows.rows.length > limit
            ? (rows.rows.at(limit - 1)
                ?.ordinal as IdeationPage<IdeationTask>["nextCursor"])
            : null,
      };
    });
  cancelIdeationTask: SessionMethods["cancelIdeationTask"] = (actor, request) =>
    this.call(actor, async (tx) => {
      const task = await this.ownedTask(tx, actor, request.taskId);
      exactIdeationRequest(request, ["taskId", "clientRequestId"]);
      return this.mutate(tx, actor, "cancelTask", request, async () => {
        if (
          [
            "AWAITING_PREVIEW_APPROVAL",
            "AWAITING_LEARNING_PLAN_APPROVAL",
          ].includes(task.status)
        ) {
          const previews = await tx.sql<{ id: string; sha256: string }>(
            "UPDATE ideation_previews SET status='rejected' WHERE project_id=$1 AND task_id=$2 AND status IN ('pending','stale') RETURNING id,sha256",
            [actor.projectId, task.id],
          );
          for (const p of previews.rows)
            await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
              type: "preview_changed",
              previewId: p.id as never,
              sha256: p.sha256 as never,
              status: "rejected",
            });
          await tx.sql(
            "UPDATE pipeline_runs SET status='CANCELLED',cancel_requested=true,finished_at=now() WHERE id=$1",
            [task.id],
          );
          await this.options.onTaskTerminal?.(tx, actor, task.id);
          await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
            type: "task_changed",
            taskId: task.id,
            status: "CANCELLED",
          });
        }
        if (["QUEUED", "RUNNING"].includes(task.status)) {
          await tx.sql(
            "UPDATE pipeline_runs SET cancel_requested=true,status=CASE WHEN status='QUEUED' THEN 'CANCELLED' ELSE status END,finished_at=CASE WHEN status='QUEUED' THEN now() ELSE finished_at END WHERE id=$1",
            [task.id],
          );
          if (task.status === "QUEUED") {
            await tx.sql("DELETE FROM ideation_outbox WHERE run_id=$1", [
              task.id,
            ]);
            await tx.sql(
              "UPDATE ideation_sessions SET current_turn_id=NULL WHERE id=$1 AND current_turn_id=$2",
              [task.sessionId, task.id],
            );
            await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
              type: "task_changed",
              taskId: task.id,
              status: "CANCELLED",
            });
            await this.options.onTaskTerminal?.(tx, actor, task.id);
          }
        }
        return this.ownedTask(tx, actor, task.id);
      });
    });
  listIdeationEvents: SessionMethods["listIdeationEvents"] = (actor, request) =>
    this.call(actor, async (tx) => {
      await ownedSession(tx, actor, request.sessionId);
      exactIdeationRequest(request, ["sessionId", "after", "limit"]);
      const { after, limit } = ideationPage(request);
      const rows = await tx.sql<{ event: IdeationEvent }>(
        `SELECT data || jsonb_build_object('version',1,'id',id::text,'projectId',project_id,'sessionId',session_id,'runId',run_id,'createdAt',created_at) AS event FROM ideation_events WHERE project_id=$1 AND session_id=$2 AND id>$3::bigint ORDER BY id LIMIT $4`,
        [actor.projectId, request.sessionId, after, limit + 1],
      );
      return {
        items: rows.rows.slice(0, limit).map((r) => r.event),
        nextCursor:
          rows.rows.length > limit
            ? (rows.rows.at(limit - 1)?.event.id ?? null)
            : null,
      };
    });
}

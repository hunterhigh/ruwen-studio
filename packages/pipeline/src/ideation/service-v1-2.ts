import type {
  IdeationActor,
  IdeationApprovalReceipt,
  IdeationEventV1_2,
  IdeationPage,
  IdeationResult,
  IdeationServiceV1_2,
} from "./contract.ts";
import {
  exactIdeationRequest,
  ideationFail,
  ideationPage,
  ideationUuid,
  ownedSession,
} from "./sessions.ts";
import type { IdeationServiceBackend } from "./specialized.ts";
import type { IdeationTransaction } from "./store.ts";
import { VerbatimPreviews } from "./verbatim.ts";

/** Versioned facade. Existing v1.1 adapters never receive an unknown preview kind. */
export function withIdeationV1_2(
  backend: IdeationServiceBackend,
): IdeationServiceV1_2 {
  const verbatim = new VerbatimPreviews(backend);
  async function kind(
    tx: IdeationTransaction,
    actor: IdeationActor,
    id: string,
  ) {
    if (!ideationUuid.test(id)) ideationFail("NOT_FOUND");
    const row = (
      await tx.sql<{ kind: string; session_id: string }>(
        "SELECT kind,session_id FROM ideation_previews WHERE id=$1 AND project_id=$2",
        [id, actor.projectId],
      )
    ).rows[0];
    if (!row) ideationFail("NOT_FOUND");
    await ownedSession(tx, actor, row.session_id);
    return row.kind;
  }
  async function owned(
    tx: IdeationTransaction,
    actor: IdeationActor,
    id: string,
  ) {
    return (await kind(tx, actor, id)) === "verbatim"
      ? (await verbatim.owned(tx, actor, id)).preview
      : backend.ownedPreview(tx, actor, id);
  }
  async function dispatch<T>(
    actor: IdeationActor,
    id: string,
    userAction: () => Promise<IdeationResult<T>>,
    legacy: () => Promise<IdeationResult<T>>,
  ): Promise<IdeationResult<T>> {
    const result = await backend.call(actor, (tx) => kind(tx, actor, id));
    if (!result.ok) return result;
    return result.value === "verbatim" ? userAction() : legacy();
  }
  const invalid = (actor: IdeationActor) =>
    backend.call<never>(actor, async () => ideationFail("INVALID_ARGUMENT"));
  return {
    createIdeationSession: backend.createIdeationSession,
    listIdeationSessions: backend.listIdeationSessions,
    getIdeationSession: backend.getIdeationSession,
    closeIdeationSession: backend.closeIdeationSession,
    listIdeationMessages: backend.listIdeationMessages,
    sendIdeationMessage: backend.sendIdeationMessage,
    createVerbatimPreview: verbatim.create,
    getPreview: (actor, request) =>
      backend.call(actor, async (tx) => {
        const preview = await owned(tx, actor, request.previewId);
        exactIdeationRequest(request, ["previewId"]);
        return preview;
      }),
    listPreviews: (actor, request) =>
      backend.call(actor, async (tx) => {
        await ownedSession(tx, actor, request.sessionId);
        exactIdeationRequest(request, [
          "sessionId",
          "after",
          "limit",
          "status",
        ]);
        const { after, limit } = ideationPage(request);
        if (
          request.status !== undefined &&
          !["pending", "approved", "rejected", "stale", "superseded"].includes(
            request.status,
          )
        )
          ideationFail("INVALID_ARGUMENT");
        await backend.reconcilePreviewStaleness(tx, actor, request.sessionId);
        // Resolve source/chapter guards before status filtering and cursor pagination.
        const pending = await tx.sql<{ id: string }>(
          "SELECT id FROM ideation_previews WHERE project_id=$1 AND session_id=$2 AND kind='verbatim' AND status='pending' ORDER BY ordinal",
          [actor.projectId, request.sessionId],
        );
        for (const row of pending.rows) await verbatim.owned(tx, actor, row.id);
        const rows = await tx.sql<{ id: string; ordinal: string }>(
          "SELECT id,ordinal::text FROM ideation_previews WHERE project_id=$1 AND session_id=$2 AND ordinal>$3::bigint AND ($4::text IS NULL OR status=$4) ORDER BY ordinal LIMIT $5",
          [
            actor.projectId,
            request.sessionId,
            after,
            request.status ?? null,
            limit + 1,
          ],
        );
        const items = [];
        for (const row of rows.rows.slice(0, limit))
          items.push(await owned(tx, actor, row.id));
        return {
          items,
          nextCursor:
            rows.rows.length > limit
              ? (rows.rows.at(limit - 1)?.ordinal as never)
              : null,
        };
      }),
    approvePreview: (actor, request) =>
      dispatch(
        actor,
        request.previewId,
        () => verbatim.approve(actor, request),
        () => backend.approvePreview(actor, request),
      ),
    rejectPreview: (actor, request) =>
      dispatch(
        actor,
        request.previewId,
        () => verbatim.reject(actor, request),
        () => backend.rejectPreview(actor, request),
      ),
    revisePreview: (actor, request) =>
      dispatch(
        actor,
        request.previewId,
        () => invalid(actor),
        () => backend.revisePreview(actor, request),
      ),
    activateExpression: (actor, request) =>
      dispatch(
        actor,
        request.previewId,
        () => invalid(actor),
        () => backend.activateExpression(actor, request),
      ),
    requestIdeationCompilation: backend.requestIdeationCompilation,
    listIdeationTasks: backend.listIdeationTasks,
    getIdeationTask: backend.getIdeationTask,
    cancelIdeationTask: backend.cancelIdeationTask,
    getIdeationApproval: (actor, request) =>
      backend.call(actor, async (tx) => {
        if (!ideationUuid.test(request.decisionId)) ideationFail("NOT_FOUND");
        const receipt = (
          await tx.sql<{ receipt: IdeationApprovalReceipt }>(
            "SELECT receipt FROM ideation_decisions WHERE id=$1 AND project_id=$2",
            [request.decisionId, actor.projectId],
          )
        ).rows[0]?.receipt;
        if (!receipt) ideationFail("NOT_FOUND");
        await owned(tx, actor, receipt.previewId);
        exactIdeationRequest(request, ["decisionId"]);
        return receipt;
      }),
    listIdeationEvents: (actor, request) =>
      backend.listIdeationEvents(actor, request) as Promise<
        IdeationResult<IdeationPage<IdeationEventV1_2>>
      >,
  };
}

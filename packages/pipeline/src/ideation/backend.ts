import { createHash, randomUUID } from "node:crypto";
import type { Data } from "@ruwen/agents";
import { handoff, registry } from "@ruwen/core";
import type {
  IdeationActor,
  IdeationCleanHandoff,
  IdeationContextScope,
  IdeationHandoffPreview,
  IdeationPage,
  IdeationPreview,
  IdeationResourceRef,
  IdeationService,
  IdeationTask,
} from "./contract.ts";
import { assertNoOriginalWording } from "./privacy.ts";
import {
  appendIdeationEvent,
  exactIdeationRequest,
  IdeationSessions,
  ideationFail,
  ideationPage,
  ideationUuid,
  ownedSession,
} from "./sessions.ts";
import type { IdeationTransaction } from "./store.ts";

export const previewBytesHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function rawCoordinatorSources(
  tx: IdeationTransaction,
  actor: IdeationActor,
  sessionId: string,
  revision?: number,
) {
  const rows = await tx.sql<{ content: string }>(
    "SELECT content FROM ideation_messages WHERE project_id=$1 AND session_id=$2 AND role='user' AND ($3::integer IS NULL OR session_revision<=$3) ORDER BY ordinal",
    [actor.projectId, sessionId, revision ?? null],
  );
  return rows.rows.map((row) => row.content);
}
export class IdeationBackend extends IdeationSessions {
  async coordinatorInput(actor: IdeationActor, taskId: string) {
    return this.store.transaction(actor, async (tx) => {
      const task = await this.ownedTask(tx, actor, taskId);
      if (task.role !== "chuangyi-xietiaoyuan") ideationFail("NOT_FOUND");
      const row = await tx.sql<{
        session_revision: number;
        project_key: string;
      }>(
        "SELECT t.session_revision,p.project_key FROM ideation_tasks t JOIN projects p ON p.id=t.project_id WHERE t.run_id=$1 AND t.project_id=$2",
        [taskId, actor.projectId],
      );
      const revision =
        row.rows[0]?.session_revision ?? ideationFail("NOT_FOUND");
      const messages = await tx.sql<{
        role: "user" | "assistant";
        content: string;
      }>(
        "SELECT role,content FROM ideation_messages WHERE project_id=$1 AND session_id=$2 AND session_revision<=$3 ORDER BY ordinal",
        [actor.projectId, task.sessionId, revision],
      );
      const sources = messages.rows
        .filter((m) => m.role === "user")
        .map((m) => m.content);
      await this.guardRun(tx, actor, task.id);
      return {
        raw_user_text: sources.join("\n"),
        conversation: messages.rows,
        project_state: { project: row.rows[0]?.project_key },
      } as Data;
    });
  }
  async ownedPreview(
    tx: IdeationTransaction,
    actor: IdeationActor,
    id: string,
  ) {
    if (!ideationUuid.test(id)) ideationFail("NOT_FOUND");
    const row = await tx.sql<{
      snapshot: string;
      sha256: string;
      status: IdeationPreview["status"];
    }>(
      "SELECT snapshot,sha256,status FROM ideation_previews WHERE id=$1 AND project_id=$2 FOR UPDATE",
      [id, actor.projectId],
    );
    const stored = row.rows[0];
    if (!stored) ideationFail("NOT_FOUND");
    const preview = {
      ...JSON.parse(stored.snapshot),
      sha256: stored.sha256,
      status: stored.status,
    } as IdeationPreview;
    await ownedSession(tx, actor, preview.sessionId);
    const task = await this.ownedTask(tx, actor, preview.taskId);
    if (
      task.sessionId !== preview.sessionId ||
      preview.projectId !== actor.projectId ||
      preview.id !== id
    )
      ideationFail("NOT_FOUND");
    if (previewBytesHash(stored.snapshot) !== stored.sha256)
      ideationFail("PREVIEW_STALE");
    if (preview.status === "pending") {
      const changed = await this.reconcilePreviewStaleness(
        tx,
        actor,
        preview.sessionId,
        id,
      );
      if (changed.includes(id)) return { ...preview, status: "stale" as const };
    }
    return preview;
  }
  async reconcilePreviewStaleness(
    tx: IdeationTransaction,
    actor: IdeationActor,
    sessionId: string,
    id?: string,
  ) {
    const current = await tx.sha256(registry.REGISTRY);
    const rows = await tx.sql<{
      id: string;
      sha256: IdeationPreview["sha256"];
      task_id: IdeationPreview["taskId"];
    }>(
      `UPDATE ideation_previews p SET status='stale' WHERE p.project_id=$1 AND p.session_id=$2 AND p.status='pending' AND ($4::uuid IS NULL OR p.id=$4) AND (
      p.snapshot::jsonb->>'registrySha256' <> $3 OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(p.snapshot::jsonb->'resources') x LEFT JOIN project_files f ON f.project_id=p.project_id AND f.path=x->>'path' WHERE f.sha256 IS DISTINCT FROM x->>'sha256') OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p.snapshot::jsonb->'patches','[]')) x LEFT JOIN project_files f ON f.project_id=p.project_id AND f.path=CASE WHEN x->>'kind'='sections' THEN x->'resource'->>'path' ELSE x->>'path' END WHERE (x->>'kind'='create' AND f.path IS NOT NULL) OR (x->>'kind'='sections' AND f.sha256 IS DISTINCT FROM x->'resource'->>'sha256'))
    ) RETURNING id,sha256,task_id`,
      [actor.projectId, sessionId, current, id ?? null],
    );
    for (const row of rows.rows)
      await appendIdeationEvent(tx, actor, sessionId, row.task_id, {
        type: "preview_changed",
        previewId: row.id as never,
        status: "stale",
        sha256: row.sha256,
      });
    return rows.rows.map((r) => r.id);
  }
  getPreview: IdeationService["getPreview"] = (actor, request) =>
    this.call(actor, async (tx) => {
      const preview = await this.ownedPreview(tx, actor, request.previewId);
      exactIdeationRequest(request, ["previewId"]);
      return preview;
    });
  listPreviews: IdeationService["listPreviews"] = (actor, request) =>
    this.call(actor, async (tx) => {
      await ownedSession(tx, actor, request.sessionId);
      exactIdeationRequest(request, ["sessionId", "after", "limit", "status"]);
      const { after, limit } = ideationPage(request);
      if (
        request.status !== undefined &&
        !["pending", "approved", "rejected", "stale", "superseded"].includes(
          request.status,
        )
      )
        ideationFail("INVALID_ARGUMENT");
      await this.reconcilePreviewStaleness(tx, actor, request.sessionId);
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
        items.push(await this.ownedPreview(tx, actor, row.id));
      return {
        items,
        nextCursor:
          rows.rows.length > limit
            ? (rows.rows.at(limit - 1)
                ?.ordinal as IdeationPage<IdeationPreview>["nextCursor"])
            : null,
      };
    });
  async savePreview(
    tx: IdeationTransaction,
    actor: IdeationActor,
    task: IdeationTask,
    snapshot: Omit<IdeationPreview, "status" | "sha256">,
  ) {
    const revision = (
      await tx.sql<{ session_revision: number }>(
        "SELECT session_revision FROM ideation_tasks WHERE run_id=$1",
        [task.id],
      )
    ).rows[0]?.session_revision;
    const sources = await rawCoordinatorSources(
      tx,
      actor,
      task.sessionId,
      revision,
    );
    assertNoOriginalWording(snapshot, sources);
    const bytes = JSON.stringify(snapshot),
      hash = previewBytesHash(bytes);
    await tx.sql(
      "INSERT INTO ideation_previews(id,project_id,session_id,task_id,kind,snapshot,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        snapshot.id,
        actor.projectId,
        task.sessionId,
        task.id,
        snapshot.kind,
        bytes,
        hash,
      ],
    );
    await tx.sql(
      "UPDATE ideation_tasks SET output_preview_ids=output_preview_ids || $2::jsonb WHERE run_id=$1",
      [task.id, JSON.stringify([snapshot.id])],
    );
    await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
      type: "preview_changed",
      previewId: snapshot.id,
      status: "pending",
      sha256: hash as never,
    });
    return { ...snapshot, sha256: hash, status: "pending" } as IdeationPreview;
  }
  async saveHandoff(
    tx: IdeationTransaction,
    actor: IdeationActor,
    task: IdeationTask,
    value: Data,
  ): Promise<IdeationHandoffPreview> {
    const boundary = await tx.sql<{
      session_revision: number;
      project_key: string;
    }>(
      "SELECT t.session_revision,p.project_key FROM ideation_tasks t JOIN projects p ON p.id=t.project_id WHERE t.run_id=$1 AND t.project_id=$2",
      [task.id, actor.projectId],
    );
    const revision =
      boundary.rows[0]?.session_revision ?? ideationFail("NOT_FOUND");
    const sources = await rawCoordinatorSources(
      tx,
      actor,
      task.sessionId,
      revision,
    );
    if (
      (await handoff.validateHandoff(value, { rawSource: sources.join("\n") }))
        .length
    )
      ideationFail("CREATION_CHECK_FAILED");
    const clean = value as unknown as IdeationCleanHandoff;
    if (
      clean.sender !== "chuangyi-xietiaoyuan" ||
      clean.approval_ref !== null ||
      !["creative_brief", "consultant_brief"].includes(clean.kind) ||
      ![
        "xiangmu-zhiliyuan",
        "waibu-zhishi-guwen",
        "biaoxian-shejishi",
        "gushi-gousishi",
      ].includes(clean.recipient)
    )
      ideationFail("CREATION_CHECK_FAILED");
    if (clean.scope.project !== boundary.rows[0]?.project_key)
      ideationFail("CREATION_CHECK_FAILED");
    const validated = await registry.validateRegistry(tx);
    if (validated.errors.length) ideationFail("PRECONDITION_FAILED");
    const resources: IdeationResourceRef[] = [];
    for (const id of clean.resource_ids) {
      const r = validated.data.resources.find((r) => r.id === id);
      if (
        !r ||
        r.scope.project !== clean.scope.project ||
        r.status !== "active" ||
        r.approval.status !== "approved" ||
        !r.readers.includes(clean.recipient)
      )
        ideationFail("READERS_DENIED");
      if ((await tx.sha256(r.path)) !== r.source_sha256)
        ideationFail("RESOURCE_STALE");
      resources.push({
        id: r.id,
        path: r.path,
        sha256: r.source_sha256,
        type: r.type,
        status: r.status,
        scope: r.scope,
      } as unknown as IdeationResourceRef);
    }
    const scope = {
      volume: null,
      arc: null,
      chapter: null,
      scene_type: null,
      pov: null,
      ...clean.scope,
    } as IdeationContextScope;
    const payload = clean.payload;
    const creative = clean.kind === "creative_brief" ? clean.payload : null;
    const consultant = clean.kind === "consultant_brief" ? clean.payload : null;
    const snapshot = {
      id: randomUUID(),
      projectId: actor.projectId,
      sessionId: task.sessionId,
      taskId: task.id,
      sessionRevision: revision,
      supersedesPreviewId: task.sourcePreviewId,
      revision: 1,
      summary: "请确认本次干净委托。",
      scope,
      resources,
      registrySha256: await tx.sha256("治理/资源注册表.json"),
      createdAt: new Date().toISOString(),
      kind: "handoff",
      role: "chuangyi-xietiaoyuan",
      handoff: clean,
      payloadSha256: previewBytesHash(JSON.stringify(payload)),
      understanding: {
        creativeValue:
          creative?.creative_value ?? consultant?.learning_goal ?? "",
        fixedFacts: creative?.fixed ?? [],
        openChoices: creative?.open_realization ?? [consultant?.unknown ?? ""],
        exampleTreatment: "示例仅用于理解创意功能。",
        destination: payload.destination,
      },
    } as unknown as Omit<IdeationHandoffPreview, "status" | "sha256">;
    return (await this.savePreview(
      tx,
      actor,
      task,
      snapshot,
    )) as IdeationHandoffPreview;
  }
}

import { randomUUID } from "node:crypto";
import type { Data, RoleResult } from "@ruwen/agents";
import { approval, handoff, ledgers, registry } from "@ruwen/core";
import {
  IdeationBackend,
  previewBytesHash,
  rawCoordinatorSources,
} from "./backend.ts";
import type {
  IdeationActor,
  IdeationApprovalReceipt,
  IdeationCleanHandoff,
  IdeationCoreApprovalRef,
  IdeationExpressionPreview,
  IdeationFilePreview,
  IdeationHandoffPreview,
  IdeationLearningPlanPreview,
  IdeationPreview,
  IdeationRunId,
  IdeationService,
  IdeationTask,
} from "./contract.ts";
import {
  buildFilePatches,
  commitFilePatches,
  registryScope,
  writablePath,
} from "./file-patches.ts";
import { assertNoOriginalWording } from "./privacy.ts";
import {
  appendIdeationEvent,
  exactIdeationRequest,
  ideationFail,
  ideationText,
  ideationUuid,
  ownedSession,
} from "./sessions.ts";
import type { IdeationTransaction } from "./store.ts";

type Snapshot<T extends IdeationPreview> = Omit<T, "status" | "sha256">;
type Applied = Pick<
  IdeationApprovalReceipt,
  "coreApprovals" | "startedTaskId" | "committedFiles" | "projectionRegistered"
>;
export class IdeationWorkflow extends IdeationBackend {
  protected async fresh(tx: IdeationTransaction, preview: IdeationPreview) {
    if (
      !(await tx.exists(registry.REGISTRY)) ||
      (await tx.sha256(registry.REGISTRY)) !== preview.registrySha256
    )
      ideationFail("PREVIEW_STALE");
    for (const resource of preview.resources)
      if (
        !(await tx.exists(resource.path)) ||
        (await tx.sha256(resource.path)) !== resource.sha256
      )
        ideationFail("PREVIEW_STALE");
  }
  async checkFresh(tx: IdeationTransaction, preview: IdeationPreview) {
    await this.fresh(tx, preview);
  }
  approvePreview: IdeationService["approvePreview"] = (actor, request) =>
    this.call(actor, async (tx) => {
      const preview = await this.ownedPreview(tx, actor, request.previewId);
      exactIdeationRequest(request, [
        "previewId",
        "clientRequestId",
        "expectedSha256",
        "confirmed",
      ]);
      if (request.confirmed !== true) ideationFail("APPROVAL_REQUIRED");
      if (!/^[a-f0-9]{64}$/.test(request.expectedSha256))
        ideationFail("INVALID_ARGUMENT");
      return this.mutate(tx, actor, "approvePreview", request, async () => {
        if (preview.status !== "pending")
          ideationFail(
            preview.status === "stale" ? "PREVIEW_STALE" : "ALREADY_DECIDED",
          );
        if (request.expectedSha256 !== preview.sha256)
          ideationFail("PREVIEW_STALE");
        await this.fresh(tx, preview);
        // Release the completed parent hold before quoting its successor in the SAME transaction.
        await this.options.onTaskTerminal?.(tx, actor, preview.taskId);
        const id = randomUUID(),
          applied = await this.applyPreview(tx, actor, preview, id);
        return this.commitDecision(tx, actor, preview, id, applied);
      });
    });
  protected async commitDecision(
    tx: IdeationTransaction,
    actor: IdeationActor,
    preview: IdeationPreview,
    id: string,
    applied: Applied,
  ) {
    const receipt = {
      id,
      projectId: actor.projectId,
      previewId: preview.id,
      approvedSha256: preview.sha256,
      ...applied,
      createdAt: new Date().toISOString(),
    } as unknown as IdeationApprovalReceipt;
    await tx.sql(
      "INSERT INTO ideation_decisions(id,project_id,session_id,preview_id,receipt) VALUES($1,$2,$3,$4,$5)",
      [
        id,
        actor.projectId,
        preview.sessionId,
        preview.id,
        JSON.stringify(receipt),
      ],
    );
    await tx.sql("UPDATE ideation_previews SET status='approved' WHERE id=$1", [
      preview.id,
    ]);
    await tx.createExclusive(
      `治理/构思决定/${id}.json`,
      `${JSON.stringify(receipt)}\n`,
    );
    await ledgers.appendAudit(tx, {
      role: preview.role,
      resource_ids:
        preview.kind === "file_patch"
          ? preview.registryChanges.map((c) => c.resourceId)
          : preview.resources.map((r) => r.id),
      change: "ideation_preview_committed",
      scope: {
        project: preview.scope.project,
        volume: preview.scope.volume,
        arc: preview.scope.arc,
        chapter: preview.scope.chapter,
      },
      conflict_category: null,
      approval_status: "approved",
      result: "committed",
    });
    await this.finishPreviewTask(tx, actor, preview);
    await appendIdeationEvent(tx, actor, preview.sessionId, preview.taskId, {
      type: "preview_changed",
      previewId: preview.id,
      status: "approved",
      sha256: preview.sha256,
    });
    await appendIdeationEvent(tx, actor, preview.sessionId, preview.taskId, {
      type: "approval_committed",
      decisionId: receipt.id,
      previewId: preview.id,
    });
    return receipt;
  }
  protected async finishPreviewTask(
    tx: IdeationTransaction,
    actor: IdeationActor,
    preview: IdeationPreview,
  ) {
    const changed = await tx.sql(
      "UPDATE pipeline_runs SET status='SUCCEEDED',finished_at=now() WHERE id=$1 AND status IN ('AWAITING_PREVIEW_APPROVAL','AWAITING_LEARNING_PLAN_APPROVAL') RETURNING id",
      [preview.taskId],
    );
    await this.options.onTaskTerminal?.(tx, actor, preview.taskId);
    if (changed.rowCount)
      await appendIdeationEvent(tx, actor, preview.sessionId, preview.taskId, {
        type: "task_changed",
        taskId: preview.taskId,
        status: "SUCCEEDED",
      });
  }
  protected async applyPreview(
    tx: IdeationTransaction,
    actor: IdeationActor,
    preview: IdeationPreview,
    decisionId: string,
  ): Promise<Applied> {
    if (preview.kind === "handoff")
      return this.dispatch(tx, actor, preview, preview.handoff, decisionId);
    if (preview.kind === "learning_plan") {
      if (preview.sourceMode === "external_search" && !this.options.search)
        ideationFail("SEARCH_UNAVAILABLE");
      return this.dispatch(
        tx,
        actor,
        preview,
        preview.execution,
        decisionId,
        "research",
      );
    }
    if (preview.kind === "file_patch")
      return {
        ...(await commitFilePatches(tx, preview, decisionId)),
        startedTaskId: null,
      };
    ideationFail(
      preview.kind === "expression_candidate"
        ? "CLOSURE_AUDIT_REQUIRED"
        : "PRECONDITION_FAILED",
    );
  }
  protected async dispatch(
    tx: IdeationTransaction,
    actor: IdeationActor,
    preview: IdeationHandoffPreview | IdeationLearningPlanPreview,
    clean: IdeationCleanHandoff,
    decisionId: string,
    phase?: "research",
  ): Promise<Applied> {
    const runId = randomUUID() as IdeationRunId;
    await this.guardRun(tx, actor, runId);
    const payload = JSON.stringify(clean.payload),
      payloadHash = previewBytesHash(payload);
    if (preview.kind === "handoff" && payloadHash !== preview.payloadSha256)
      ideationFail("PREVIEW_STALE");
    const target = `治理/交接/${preview.id}.payload.json`;
    await tx.createExclusive(target, payload);
    const eventId = `handoff-${decisionId}`;
    const event = await approval.createEvent(
        tx,
        eventId,
        "handoff_execute",
        target,
        true,
      ),
      eventPath = String(event.event),
      eventSha = await tx.sha256(eventPath);
    const executable = {
      ...clean,
      approval_ref: { path: eventPath, sha256: eventSha },
    } as unknown as Data;
    if ((await handoff.executeHandoff(tx, executable)).length)
      ideationFail("APPROVAL_REQUIRED");
    const stage =
      phase ??
      (
        {
          "xiangmu-zhiliyuan": "governance",
          "gushi-gousishi": "story",
          "waibu-zhishi-guwen": "learning_plan",
          "biaoxian-shejishi": "expression",
        } as const
      )[clean.recipient];
    await tx.sql(
      "INSERT INTO pipeline_runs(id,project_id,kind,status,request) VALUES($1,$2,'ideation_execution','QUEUED',$3)",
      [
        runId,
        actor.projectId,
        JSON.stringify({
          sessionId: preview.sessionId,
          sourcePreviewId: preview.id,
          decisionId,
        }),
      ],
    );
    await tx.sql(
      "INSERT INTO ideation_tasks(run_id,project_id,session_id,role,stage,source_preview_id,session_revision) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        runId,
        actor.projectId,
        preview.sessionId,
        clean.recipient,
        stage,
        preview.id,
        preview.sessionRevision,
      ],
    );
    await tx.sql(
      "INSERT INTO ideation_outbox(run_id,queue_name) VALUES($1,$2)",
      [runId, this.options.queue ?? "ruwen-work"],
    );
    const refused = await this.options.onRunAccepted?.(tx, actor, runId);
    if (refused) ideationFail(refused);
    await appendIdeationEvent(tx, actor, preview.sessionId, runId, {
      type: "task_changed",
      taskId: runId,
      status: "QUEUED",
    });
    const core = {
      id: eventId,
      path: eventPath,
      sha256: eventSha,
      action: "handoff_execute",
      target: { path: target, sha256: payloadHash },
    } as unknown as IdeationCoreApprovalRef;
    return {
      coreApprovals: [core],
      startedTaskId: runId,
      committedFiles: [],
      projectionRegistered: false,
    };
  }
  async executionInput(actor: IdeationActor, taskId: string) {
    return this.store.transaction(actor, async (tx) => {
      const task = await this.ownedTask(tx, actor, taskId);
      if (!task.sourcePreviewId) ideationFail("APPROVAL_REQUIRED");
      const preview = await this.ownedPreview(tx, actor, task.sourcePreviewId);
      if (
        preview.status !== "approved" ||
        preview.sessionId !== task.sessionId ||
        !["handoff", "learning_plan"].includes(preview.kind)
      )
        ideationFail("APPROVAL_REQUIRED");
      const decision = await tx.sql<{ receipt: IdeationApprovalReceipt }>(
        "SELECT receipt FROM ideation_decisions WHERE project_id=$1 AND preview_id=$2",
        [actor.projectId, preview.id],
      );
      const receipt = decision.rows[0]?.receipt;
      if (
        !receipt ||
        receipt.startedTaskId !== task.id ||
        receipt.approvedSha256 !== preview.sha256
      )
        ideationFail("APPROVAL_REQUIRED");
      const clean =
        preview.kind === "handoff"
          ? preview.handoff
          : preview.kind === "learning_plan"
            ? preview.execution
            : ideationFail("APPROVAL_REQUIRED");
      if (clean.recipient !== task.role) ideationFail("APPROVAL_REQUIRED");
      const ref = receipt.coreApprovals.find(
        (a) => a.action === "handoff_execute",
      );
      if (!ref) ideationFail("APPROVAL_REQUIRED");
      const event = JSON.parse(await tx.readText(ref.path));
      if (
        (await tx.sha256(ref.path)) !== ref.sha256 ||
        previewBytesHash(JSON.stringify(clean.payload)) !== ref.target.sha256
      )
        ideationFail("PREVIEW_STALE");
      await approval.validateEvent(
        tx,
        event,
        "handoff_execute",
        ref.target.path,
        undefined,
        true,
      );
      if (!(await approval.eventIsCommitted(tx, String(event.id))))
        ideationFail("APPROVAL_REQUIRED");
      if ((await tx.sha256(ref.target.path)) !== ref.target.sha256)
        ideationFail("PREVIEW_STALE");
      for (const source of preview.resources)
        if (
          !(await tx.exists(source.path)) ||
          (await tx.sha256(source.path)) !== source.sha256
        )
          ideationFail("RESOURCE_STALE");
      await this.guardRun(tx, actor, task.id);
      const input: Data = {
        brief: clean.payload as unknown as Data,
        resource_ids: [...clean.resource_ids],
        scope: preview.scope as unknown as Data,
      };
      if (task.stage === "research") {
        if (preview.kind !== "learning_plan") ideationFail("APPROVAL_REQUIRED");
        if (preview.sourceMode === "external_search" && !this.options.search)
          ideationFail("SEARCH_UNAVAILABLE");
        input.approved_learning_plan = {
          known: preview.known,
          unknown: preview.unknown,
          plan: [...preview.plan],
          boundary: preview.boundary,
          potential_conflicts: [...preview.potentialConflicts],
          destination: preview.destination,
        };
      }
      if (task.role === "biaoxian-shejishi")
        input.approved_resources = clean.resource_ids.map((id) => ({ id }));
      const revision = (
        await tx.sql<{ session_revision: number }>(
          "SELECT session_revision FROM ideation_tasks WHERE run_id=$1",
          [task.id],
        )
      ).rows[0]?.session_revision;
      assertNoOriginalWording(
        input,
        await rawCoordinatorSources(tx, actor, task.sessionId, revision),
      );
      return {
        input,
        scope: preview.scope,
        search:
          task.stage === "research" &&
          preview.kind === "learning_plan" &&
          preview.sourceMode === "external_search"
            ? this.options.search
            : undefined,
      };
    });
  }
  async saveDownstream(
    tx: IdeationTransaction,
    actor: IdeationActor,
    task: IdeationTask,
    result: RoleResult,
  ) {
    if (!task.sourcePreviewId || typeof result.output !== "object")
      ideationFail("OUTPUT_BLOCKED");
    const source = await this.ownedPreview(tx, actor, task.sourcePreviewId),
      output = result.output;
    const boundary =
      (
        await tx.sql<{ session_revision: number }>(
          "SELECT session_revision FROM ideation_tasks WHERE run_id=$1",
          [task.id],
        )
      ).rows[0]?.session_revision ?? ideationFail("NOT_FOUND");
    const raw = await rawCoordinatorSources(
      tx,
      actor,
      task.sessionId,
      boundary,
    );
    // Names of newly proposed resources are model text too, not trusted existing reference tokens.
    assertNoOriginalWording(
      {
        proposed_names: (Array.isArray(output.new_files)
          ? output.new_files
          : []
        ).map((file) => {
          const v = file as Data;
          return `${v.resource_id ?? ""}\n${v.path ?? ""}`;
        }),
        proposed_expression_name:
          task.role === "biaoxian-shejishi"
            ? `${output.resource_id}\n${output.resource_path}\n${output.version}`
            : "",
      },
      raw,
    );
    const base = {
      id: randomUUID(),
      projectId: actor.projectId,
      sessionId: task.sessionId,
      taskId: task.id,
      sessionRevision: boundary,
      supersedesPreviewId: null,
      revision: 1,
      scope: source.scope,
      resources: source.resources,
      registrySha256: await tx.sha256(registry.REGISTRY),
      createdAt: new Date().toISOString(),
    };
    const currentRegistry = await registry.readRegistry(tx);
    const refs = new Map(source.resources.map((r) => [String(r.id), r]));
    for (const read of result.readResources) {
      const r = currentRegistry.resources.find((r) => r.id === read.id);
      if (
        !r ||
        !r.readers.includes(task.role) ||
        r.status !== "active" ||
        r.approval.status !== "approved" ||
        r.source_sha256 !== read.sha256
      )
        ideationFail("READERS_DENIED");
      refs.set(r.id, {
        id: r.id,
        path: r.path,
        sha256: r.source_sha256,
        type: r.type,
        status: r.status,
        scope: r.scope,
      } as unknown as (typeof source.resources)[number]);
    }
    base.resources = [...refs.values()];
    if (task.stage === "learning_plan") {
      if (
        output.mode !== "learning_plan" ||
        !Array.isArray(output.plan) ||
        output.plan.length === 0 ||
        !Array.isArray(output.evidence) ||
        output.evidence.length !== 0
      )
        ideationFail("OUTPUT_BLOCKED");
      if (source.kind !== "handoff") ideationFail("APPROVAL_REQUIRED");
      const clean = source.handoff,
        creative = clean.kind === "creative_brief" ? clean.payload : null,
        consultant = clean.kind === "consultant_brief" ? clean.payload : null;
      const payload = consultant ?? {
        known: creative?.fixed.join("；") || "仅依据已批准的项目资料。",
        unknown:
          creative?.unresolved_forces.join("；") || "待调查的问题仍保持开放。",
        learning_goal: creative?.creative_value || "核对当前任务所需的资料。",
        boundary: "只提供证据、冲突和归属建议。",
        allowed_sources: ["existing_materials"],
        destination: clean.payload.destination,
      };
      const execution = {
        kind: "consultant_brief",
        sender: "chuangyi-xietiaoyuan",
        recipient: "waibu-zhishi-guwen",
        resource_ids: clean.resource_ids,
        scope: clean.scope,
        approval_ref: null,
        payload,
      } as IdeationLearningPlanPreview["execution"];
      const raw = await rawCoordinatorSources(
        tx,
        actor,
        task.sessionId,
        boundary,
      );
      if (
        (
          await handoff.validateHandoff(execution, {
            rawSource: raw.join("\n"),
          })
        ).length
      )
        ideationFail("CREATION_CHECK_FAILED");
      const sourceMode = payload.allowed_sources.some((v) =>
        /external_search|https?:|联网|互联网/i.test(v),
      )
        ? "external_search"
        : "existing_materials";
      return this.savePreview(tx, actor, task, {
        ...base,
        kind: "learning_plan",
        role: "waibu-zhishi-guwen",
        summary: "请确认学习范围，再开始调查。",
        known: payload.known,
        unknown: payload.unknown,
        plan: output.plan,
        boundary: payload.boundary,
        potentialConflicts: output.conflicts,
        destination: payload.destination,
        sourceMode,
        execution,
      } as unknown as Snapshot<IdeationLearningPlanPreview>);
    }
    if (task.role === "biaoxian-shejishi") {
      const id = String(output.resource_id),
        path = String(output.resource_path),
        content = String(output.content),
        version = String(output.version);
      writablePath(tx, path, "expression");
      if (
        !registry.authorPathAllowed(path) ||
        !/^\d+\.\d+\.\d+(?:[-+][a-z0-9.-]+)?$/.test(version) ||
        !/^[a-z0-9-]{2,64}$/.test(id)
      )
        ideationFail("OUTPUT_BLOCKED");
      const data = await registry.readRegistry(tx);
      if (data.resources.some((r) => r.id === id) || (await tx.exists(path)))
        ideationFail("RESOURCE_STALE");
      const hash = previewBytesHash(content),
        scope = registryScope(source.scope);
      const resource = {
        id,
        path,
        sha256: hash,
        type: "expression",
        status: "proposed",
        scope,
      };
      const after = {
        ...resource,
        status: "candidate",
        owner: "biaoxian-shejishi",
        version,
        readers: [
          "xiangmu-zhiliyuan",
          "biaoxian-shejishi",
          "zhangjie-qingjing-bianyiyuan",
          "xiaoshuo-zuozhe",
        ],
        allowAuthor: true,
        supersedes: null,
      };
      return this.savePreview(tx, actor, task, {
        ...base,
        kind: "expression_candidate",
        role: "biaoxian-shejishi",
        summary: "请审阅表现能力提案。",
        approvalStage: "candidate",
        resource,
        patches: [
          {
            kind: "create",
            resourceId: id,
            path,
            baseSha256: null,
            content,
            afterSha256: hash,
          },
        ],
        registryChanges: [{ resourceId: id, before: null, after }],
        closureAudit: { status: "pending", report: null, checks: [] },
        trial: {
          status: "pending",
          report: null,
          sample: null,
          nonCanonical: true,
        },
      } as unknown as Snapshot<IdeationExpressionPreview>);
    }
    let patches: Awaited<ReturnType<typeof buildFilePatches>>;
    if (task.stage === "research") {
      if (output.mode !== "research_report") ideationFail("OUTPUT_BLOCKED");
      const content =
        "# 调查材料\n\n## 证据与不确定性\n\n" +
        JSON.stringify(
          {
            evidence: output.evidence,
            opportunities: output.opportunities,
            conflicts: output.conflicts,
            destination: output.destination,
          },
          null,
          2,
        ) +
        "\n";
      const file = {
        resource_id: `evidence-${task.id}`,
        path: `研究/构思/${task.id}.md`,
        type: "evidence",
        content,
      };
      patches = await buildFilePatches(
        tx,
        { ...result, output: { ...output, new_files: [file] } },
        task.role,
        source.scope,
      );
    } else
      patches = await buildFilePatches(tx, result, task.role, source.scope);
    return this.savePreview(tx, actor, task, {
      ...base,
      kind: "file_patch",
      role: task.role,
      summary: "请审阅资料变更。",
      explanation:
        task.stage === "research"
          ? "调查只提交证据与归属，不决定正典或项目声音。"
          : typeof output.summary === "string"
            ? output.summary
            : "根据已批准委托生成资料预览。",
      ...patches,
    } as unknown as Snapshot<IdeationFilePreview>);
  }
  getIdeationApproval: IdeationService["getIdeationApproval"] = (
    actor,
    request,
  ) =>
    this.call(actor, async (tx) => {
      if (!ideationUuid.test(request.decisionId)) ideationFail("NOT_FOUND");
      const row = await tx.sql<{ receipt: IdeationApprovalReceipt }>(
        "SELECT receipt FROM ideation_decisions WHERE id=$1 AND project_id=$2",
        [request.decisionId, actor.projectId],
      );
      const receipt = row.rows[0]?.receipt;
      if (!receipt) ideationFail("NOT_FOUND");
      await this.ownedPreview(tx, actor, receipt.previewId);
      exactIdeationRequest(request, ["decisionId"]);
      return receipt;
    });
  rejectPreview: IdeationService["rejectPreview"] = (actor, request) =>
    this.call(actor, async (tx) => {
      const preview = await this.ownedPreview(tx, actor, request.previewId);
      exactIdeationRequest(request, [
        "previewId",
        "clientRequestId",
        "expectedSha256",
        "reason",
      ]);
      if (request.reason !== undefined) ideationText(request.reason);
      return this.mutate(tx, actor, "rejectPreview", request, async () => {
        if (preview.status !== "pending") ideationFail("ALREADY_DECIDED");
        if (request.expectedSha256 !== preview.sha256)
          ideationFail("PREVIEW_STALE");
        let messageId: string | null = null;
        if (request.reason !== undefined) {
          messageId = randomUUID();
          const session = await ownedSession(tx, actor, preview.sessionId),
            revision = session.revision + 1;
          await tx.sql(
            "INSERT INTO ideation_messages(id,project_id,session_id,role,content,session_revision) VALUES($1,$2,$3,'user',$4,$5)",
            [
              messageId,
              actor.projectId,
              preview.sessionId,
              JSON.stringify(request.reason),
              revision,
            ],
          );
          await tx.sql(
            "UPDATE ideation_sessions SET revision=$2,updated_at=now() WHERE id=$1",
            [preview.sessionId, revision],
          );
        }
        await tx.sql(
          "UPDATE ideation_previews SET status='rejected' WHERE id=$1",
          [preview.id],
        );
        await this.finishPreviewTask(tx, actor, preview);
        await appendIdeationEvent(
          tx,
          actor,
          preview.sessionId,
          preview.taskId,
          {
            type: "preview_changed",
            previewId: preview.id,
            status: "rejected",
            sha256: preview.sha256,
          },
        );
        return {
          previewId: preview.id,
          status: "rejected" as const,
          coordinatorMessageId: messageId as never,
        };
      });
    });
  revisePreview: IdeationService["revisePreview"] = (actor, request) =>
    this.call(actor, async (tx) => {
      const preview = await this.ownedPreview(tx, actor, request.previewId),
        session = await ownedSession(tx, actor, preview.sessionId);
      exactIdeationRequest(request, [
        "previewId",
        "clientRequestId",
        "expectedSha256",
        "content",
      ]);
      ideationText(request.content);
      return this.mutate(tx, actor, "revisePreview", request, async () => {
        if (!["pending", "stale"].includes(preview.status))
          ideationFail("ALREADY_DECIDED");
        if (request.expectedSha256 !== preview.sha256)
          ideationFail("PREVIEW_STALE");
        if (session.status === "closed") ideationFail("SESSION_CLOSED");
        await this.options.onTaskTerminal?.(tx, actor, preview.taskId);
        const accepted = await this.acceptMessage(tx, actor, session, {
          sessionId: session.id,
          clientRequestId: request.clientRequestId,
          expectedSessionRevision: session.revision,
          content: request.content,
        });
        await tx.sql(
          "UPDATE ideation_previews SET status='superseded' WHERE id=$1",
          [preview.id],
        );
        await this.finishPreviewTask(tx, actor, preview);
        await tx.sql(
          "UPDATE pipeline_runs SET request=request || $2::jsonb WHERE id=$1",
          [
            accepted.turnId,
            JSON.stringify({ supersedesPreviewId: preview.id }),
          ],
        );
        await tx.sql(
          "UPDATE ideation_tasks SET source_preview_id=$2 WHERE run_id=$1",
          [accepted.turnId, preview.id],
        );
        await appendIdeationEvent(
          tx,
          actor,
          preview.sessionId,
          preview.taskId,
          {
            type: "preview_changed",
            previewId: preview.id,
            status: "superseded",
            sha256: preview.sha256,
          },
        );
        return accepted;
      });
    });
}

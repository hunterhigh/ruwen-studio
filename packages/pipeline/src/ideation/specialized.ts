import { randomUUID } from "node:crypto";
import type { Data, RoleResult } from "@ruwen/agents";
import { approval, checks, registry, state } from "@ruwen/core";
import { previewBytesHash } from "./backend.ts";
import {
  compilationSources,
  ideationAuthorManifest,
  ownedCompilationLocators,
} from "./compilation.ts";
import type {
  IdeationActor,
  IdeationCompilationRequest,
  IdeationExpressionPreview,
  IdeationGenerationFieldPreview,
  IdeationPreview,
  IdeationRole,
  IdeationRunId,
  IdeationService,
  IdeationTask,
} from "./contract.ts";
import {
  evidenceBytes,
  expressionAudit,
  fileRef,
  requireCandidate,
  trialEvidence,
} from "./expression.ts";
import { resourceMetadata } from "./file-patches.ts";
import { assertNoOriginalWording } from "./privacy.ts";
import { downstreamOriginalSources } from "./published.ts";
import {
  appendIdeationEvent,
  exactIdeationRequest,
  ideationDigest,
  ideationFail,
  ideationHash,
  ownedSession,
} from "./sessions.ts";
import type { IdeationTransaction } from "./store.ts";
import { IdeationWorkflow } from "./workflow.ts";

type ProposedExpression = Omit<IdeationExpressionPreview, "status" | "sha256">;
export class IdeationServiceBackend
  extends IdeationWorkflow
  implements IdeationService
{
  protected override async saveExpressionProposal(
    tx: IdeationTransaction,
    actor: IdeationActor,
    task: IdeationTask,
    preview: ProposedExpression,
    result: RoleResult,
  ) {
    const output = result.output as Data;
    const review = (Array.isArray(output.closure_review)
      ? output.closure_review
      : []) as unknown as IdeationExpressionPreview["closureAudit"]["checks"];
    const before = output.supersedes_resource_id;
    let proposal = {
      ...preview,
      closureAudit: { ...preview.closureAudit, checks: review },
    };
    if (before !== undefined && before !== null) {
      const old = (await registry.readRegistry(tx)).resources.find(
        (r) => r.id === before,
      );
      const metadata = preview.registryChanges[0]?.after;
      if (
        !old ||
        old.type !== "expression" ||
        old.status !== "active" ||
        old.scope.project !== preview.scope.project ||
        !old.readers.includes(task.role) ||
        !metadata ||
        metadata.version === old.version ||
        !registry.scopesOverlap(old.scope, metadata.scope as unknown as Data)
      )
        ideationFail("PRECONDITION_FAILED");
      proposal = {
        ...proposal,
        resources: [...proposal.resources, resourceMetadata(old)],
        registryChanges: proposal.registryChanges.map((c) => ({
          ...c,
          after: { ...c.after, supersedes: old.id as never },
        })),
      };
    }
    const audit = await expressionAudit(tx, proposal),
      bytes = evidenceBytes(audit);
    proposal = {
      ...proposal,
      closureAudit: {
        checks: review,
        status:
          audit.pass === true ? "passed" : review.length ? "failed" : "pending",
        report: fileRef(
          `authoring-ruwen-v5/reports/ideation/${preview.id}.closure.json`,
          bytes,
        ),
      },
    };
    return this.savePreview(tx, actor, task, proposal);
  }
  protected override async fresh(
    tx: IdeationTransaction,
    preview: IdeationPreview,
  ) {
    await super.fresh(tx, preview);
    if (preview.kind === "generation_field") {
      const stored = await this.compilationContext(
        tx,
        { projectId: preview.projectId },
        preview.taskId,
      );
      if (
        stored.chapter !== preview.chapter ||
        ideationDigest(stored.scope) !== ideationDigest(preview.scope)
      )
        ideationFail("PREVIEW_STALE");
    }
    if (
      preview.kind === "expression_candidate" &&
      preview.approvalStage === "activation"
    )
      await requireCandidate(tx, preview);
  }
  private async enqueue(
    tx: IdeationTransaction,
    actor: IdeationActor,
    sessionId: string,
    revision: number,
    role: IdeationRole,
    stage: IdeationTask["stage"],
    sourcePreviewId: string | null,
    request: object,
  ) {
    const id = randomUUID() as IdeationRunId;
    await this.guardRun(tx, actor, id);
    await tx.sql(
      "INSERT INTO pipeline_runs(id,project_id,kind,status,request) VALUES($1,$2,'ideation_execution','QUEUED',$3)",
      [id, actor.projectId, JSON.stringify({ sessionId, ...request })],
    );
    await tx.sql(
      "INSERT INTO ideation_tasks(run_id,project_id,session_id,role,stage,source_preview_id,session_revision) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [id, actor.projectId, sessionId, role, stage, sourcePreviewId, revision],
    );
    await tx.sql(
      "INSERT INTO ideation_outbox(run_id,queue_name) VALUES($1,$2)",
      [id, this.options.queue ?? "ruwen-work"],
    );
    const refused = await this.options.onRunAccepted?.(tx, actor, id);
    if (refused) ideationFail(refused);
    await appendIdeationEvent(tx, actor, sessionId, id, {
      type: "task_changed",
      taskId: id,
      status: "QUEUED",
    });
    return id;
  }
  protected override async applyPreview(
    tx: IdeationTransaction,
    actor: IdeationActor,
    preview: IdeationPreview,
    decisionId: string,
  ) {
    if (preview.kind === "generation_field")
      return this.commitGeneration(tx, actor, preview);
    if (preview.kind !== "expression_candidate")
      return super.applyPreview(tx, actor, preview, decisionId);
    if (preview.approvalStage !== "candidate")
      ideationFail("NONCANONICAL_TRIAL_REQUIRED");
    if (
      preview.closureAudit.status !== "passed" ||
      !preview.closureAudit.report
    )
      ideationFail("CLOSURE_AUDIT_REQUIRED");
    const audit = await expressionAudit(tx, preview),
      bytes = evidenceBytes(audit);
    if (
      audit.pass !== true ||
      previewBytesHash(bytes) !== preview.closureAudit.report.sha256
    )
      ideationFail("CLOSURE_AUDIT_REQUIRED");
    const patch = preview.patches[0],
      after = preview.registryChanges[0]?.after;
    if (
      !patch ||
      patch.kind !== "create" ||
      !after ||
      preview.patches.length !== 1 ||
      preview.registryChanges.length !== 1 ||
      patch.path !== after.path ||
      previewBytesHash(patch.content) !== after.sha256
    )
      ideationFail("PREVIEW_STALE");
    const data = await registry.readRegistry(tx);
    if (data.resources.some((r) => r.id === after.id || r.path === after.path))
      ideationFail("RESOURCE_STALE");
    await tx.createExclusive(patch.path, patch.content);
    await tx.createExclusive(preview.closureAudit.report.path, bytes);
    data.resources.push({
      id: after.id,
      path: after.path,
      type: "expression",
      owner: after.owner,
      version: after.version,
      status: "proposed",
      scope: after.scope,
      source_sha256: after.sha256,
      readers: [...after.readers],
      allow_author: after.allowAuthor,
      supersedes: after.supersedes,
      approval: { status: "unapproved", approved_at: null, approved_by: null },
    } as unknown as registry.Resource);
    await tx.write(registry.REGISTRY, evidenceBytes(data));
    await registry.transition(tx, after.id, "candidate", {
      closureAudit: preview.closureAudit.report.path,
    });
    const id = await this.enqueue(
      tx,
      actor,
      preview.sessionId,
      preview.sessionRevision,
      "biaoxian-shejishi",
      "expression",
      preview.id,
      { phase: "expression_trial", sourcePreviewId: preview.id, decisionId },
    );
    return {
      coreApprovals: [],
      startedTaskId: id,
      committedFiles: [
        fileRef(patch.path, patch.content),
        preview.closureAudit.report,
      ],
      projectionRegistered: false,
    };
  }
  override async executionInput(actor: IdeationActor, taskId: string) {
    const task = await this.store.transaction(actor, (tx) =>
      this.ownedTask(tx, actor, taskId),
    );
    if (task.stage === "compilation")
      return this.store.transaction(actor, async (tx) => {
        const current = await this.ownedTask(tx, actor, taskId),
          compiled = await this.compilationContext(tx, actor, taskId);
        await this.guardRun(tx, actor, current.id);
        await this.assertTaskPrivacy(tx, actor, current, compiled.input);
        return {
          input: compiled.input,
          scope: compiled.scope,
          search: undefined,
          phase: undefined as "expression_trial" | undefined,
        };
      });
    if (task.role === "biaoxian-shejishi" && task.sourcePreviewId) {
      const phase = await this.store.transaction(actor, (tx) =>
        tx.sql<{ request: { phase?: string } }>(
          "SELECT request FROM pipeline_runs WHERE id=$1 AND project_id=$2",
          [taskId, actor.projectId],
        ),
      );
      if (phase.rows[0]?.request.phase === "expression_trial")
        return this.store.transaction(actor, async (tx) => {
          const current = await this.ownedTask(tx, actor, taskId),
            preview = await this.ownedPreview(
              tx,
              actor,
              current.sourcePreviewId ?? ideationFail("APPROVAL_REQUIRED"),
            );
          if (
            preview.kind !== "expression_candidate" ||
            preview.approvalStage !== "candidate" ||
            preview.status !== "approved"
          )
            ideationFail("APPROVAL_REQUIRED");
          const decision = (
            await tx.sql<{
              receipt: { startedTaskId: string; approvedSha256: string };
            }>(
              "SELECT receipt FROM ideation_decisions WHERE preview_id=$1 AND project_id=$2",
              [preview.id, actor.projectId],
            )
          ).rows[0]?.receipt;
          if (
            !decision ||
            decision.startedTaskId !== current.id ||
            decision.approvedSha256 !== preview.sha256
          )
            ideationFail("APPROVAL_REQUIRED");
          for (const ref of preview.resources)
            if ((await tx.sha256(ref.path)) !== ref.sha256)
              ideationFail("RESOURCE_STALE");
          const resource = await requireCandidate(tx, preview);
          await this.guardRun(tx, actor, current.id);
          const input: Data = {
            noncanonical_trial: true,
            scope: preview.scope as unknown as Data,
            trial_candidate: {
              id: resource.id,
              version: resource.version,
              path: resource.path,
              sha256: resource.source_sha256,
              content: await tx.readText(resource.path),
            },
          };
          await this.assertTaskPrivacy(tx, actor, current, input);
          return {
            input,
            scope: preview.scope,
            search: undefined,
            phase: "expression_trial" as "expression_trial" | undefined,
          };
        });
    }
    return {
      ...(await super.executionInput(actor, taskId)),
      phase: undefined as "expression_trial" | undefined,
    };
  }
  private async assertTaskPrivacy(
    tx: IdeationTransaction,
    actor: IdeationActor,
    task: IdeationTask,
    value: unknown,
  ) {
    const revision = (
      await tx.sql<{ session_revision: number }>(
        "SELECT session_revision FROM ideation_tasks WHERE run_id=$1",
        [task.id],
      )
    ).rows[0]?.session_revision;
    assertNoOriginalWording(
      value,
      await downstreamOriginalSources(tx, actor, task.sessionId, revision),
    );
  }
  override async saveDownstream(
    tx: IdeationTransaction,
    actor: IdeationActor,
    task: IdeationTask,
    result: RoleResult,
  ) {
    if (task.stage === "compilation")
      return this.generationPreview(tx, actor, task, result);
    if (task.role === "biaoxian-shejishi" && task.sourcePreviewId) {
      const parent = await this.ownedPreview(tx, actor, task.sourcePreviewId);
      if (parent.kind === "expression_candidate")
        return this.trialPreview(tx, actor, task, parent, result);
    }
    return super.saveDownstream(tx, actor, task, result);
  }
  private async trialPreview(
    tx: IdeationTransaction,
    actor: IdeationActor,
    task: IdeationTask,
    parent: IdeationExpressionPreview,
    result: RoleResult,
  ) {
    if (
      typeof result.output !== "object" ||
      result.output.canonical !== false ||
      typeof result.output.sample !== "string"
    )
      ideationFail("OUTPUT_BLOCKED");
    const sample = result.output.sample;
    if (
      Array.from(sample).length < 80 ||
      Array.from(sample).length > 4000 ||
      checks.candidateProseErrors(sample).length
    )
      ideationFail("OUTPUT_BLOCKED");
    const candidate = await requireCandidate(tx, parent),
      trial = trialEvidence(candidate, task.id, sample),
      before = resourceMetadata(candidate);
    await this.assertTaskPrivacy(tx, actor, task, { sample });
    return this.savePreview(tx, actor, task, {
      ...parent,
      id: randomUUID(),
      taskId: task.id,
      supersedesPreviewId: null,
      sha256: undefined,
      status: undefined,
      approvalStage: "activation",
      createdAt: new Date().toISOString(),
      summary: "请阅读非正典试写，再明确决定是否激活。",
      resource: { ...parent.resource, status: "candidate" },
      resources: [...parent.resources, before],
      registrySha256: await tx.sha256(registry.REGISTRY),
      patches: [],
      registryChanges: [
        {
          resourceId: before.id,
          before,
          after: { ...before, status: "active" },
        },
      ],
      trial: {
        status: "passed",
        report: trial.report,
        sample,
        nonCanonical: true,
      },
    } as unknown as ProposedExpression);
  }
  activateExpression: IdeationService["activateExpression"] = (
    actor,
    request,
  ) =>
    this.call(actor, async (tx) => {
      const preview = await this.ownedPreview(tx, actor, request.previewId);
      const resources = await registry.readRegistry(tx),
        resource = resources.resources.find((r) => r.id === request.resourceId);
      if (
        !resource ||
        preview.kind !== "expression_candidate" ||
        preview.resource.id !== resource.id
      )
        ideationFail("NOT_FOUND");
      exactIdeationRequest(request, [
        "previewId",
        "clientRequestId",
        "expectedSha256",
        "confirmed",
        "resourceId",
        "expectedResourceSha256",
        "trialReadConfirmed",
      ]);
      if (request.confirmed !== true) ideationFail("APPROVAL_REQUIRED");
      ideationHash(request.expectedSha256);
      ideationHash(request.expectedResourceSha256);
      if (request.trialReadConfirmed !== true)
        ideationFail("NONCANONICAL_TRIAL_REQUIRED");
      return this.mutate(tx, actor, "activateExpression", request, async () => {
        if (preview.status !== "pending")
          ideationFail(
            preview.status === "stale" ? "PREVIEW_STALE" : "ALREADY_DECIDED",
          );
        if (
          preview.sha256 !== request.expectedSha256 ||
          resource.source_sha256 !== request.expectedResourceSha256
        )
          ideationFail("PREVIEW_STALE");
        if (
          preview.approvalStage !== "activation" ||
          preview.trial.status !== "passed" ||
          !preview.trial.sample ||
          !preview.trial.report ||
          !preview.closureAudit.report
        )
          ideationFail("NONCANONICAL_TRIAL_REQUIRED");
        await this.fresh(tx, preview);
        const trial = trialEvidence(
          await requireCandidate(tx, preview),
          preview.taskId,
          preview.trial.sample,
        );
        if (
          trial.report.sha256 !== preview.trial.report.sha256 ||
          trial.report.path !== preview.trial.report.path
        )
          ideationFail("PREVIEW_STALE");
        await tx.createExclusive(trial.samplePath, preview.trial.sample);
        await tx.createExclusive(trial.reportPath, trial.bytes);
        const id = randomUUID(),
          eventId = `expression-${id}`,
          created = await approval.createEvent(
            tx,
            eventId,
            "expression_activate",
            resource.path,
            true,
          ),
          path = String(created.event),
          hash = await tx.sha256(path);
        await registry.transition(tx, resource.id, "active", {
          approved: true,
          approvalEvent: path,
          closureAudit: preview.closureAudit.report.path,
          trialReport: trial.reportPath,
        });
        return this.commitDecision(tx, actor, preview, id, {
          startedTaskId: null,
          coreApprovals: [
            {
              id: eventId as never,
              action: "expression_activate",
              path: path as never,
              sha256: hash as never,
              target: fileRef(resource.path, await tx.readText(resource.path)),
            },
          ],
          committedFiles: [
            fileRef(trial.samplePath, preview.trial.sample),
            trial.report,
          ],
          projectionRegistered: false,
        });
      });
    });
  requestIdeationCompilation: IdeationService["requestIdeationCompilation"] = (
    actor,
    request,
  ) =>
    this.call(actor, async (tx) => {
      const session = await ownedSession(tx, actor, request.sessionId);
      await ownedCompilationLocators(tx, request.sources);
      exactIdeationRequest(request, [
        "sessionId",
        "clientRequestId",
        "chapter",
        "scope",
        "sources",
      ]);
      return this.mutate(tx, actor, "requestCompilation", request, async () => {
        const compiled = await compilationSources(tx, actor, request);
        assertNoOriginalWording(
          compiled.input,
          await downstreamOriginalSources(
            tx,
            actor,
            session.id,
            session.revision,
          ),
        );
        const id = await this.enqueue(
          tx,
          actor,
          session.id,
          session.revision,
          "zhangjie-qingjing-bianyiyuan",
          "compilation",
          null,
          {
            chapter: compiled.chapter,
            scope: request.scope,
            sources: compiled.resources.map((r) => ({
              resourceId: r.id,
              expectedSha256: r.sha256,
            })),
            stateSha256: compiled.stateSha256,
            registrySha256: compiled.registrySha256,
            manifestSha256: compiled.manifestSha256,
          },
        );
        return this.ownedTask(tx, actor, id);
      });
    });
  private async compilationContext(
    tx: IdeationTransaction,
    actor: Pick<IdeationActor, "projectId">,
    taskId: string,
  ) {
    const row = (
      await tx.sql<{
        request: IdeationCompilationRequest & {
          stateSha256: string;
          registrySha256: string;
          manifestSha256: string;
        };
      }>("SELECT request FROM pipeline_runs WHERE id=$1 AND project_id=$2", [
        taskId,
        actor.projectId,
      ])
    ).rows[0];
    if (!row) ideationFail("NOT_FOUND");
    if (
      (await tx.sha256(state.STATE)) !== row.request.stateSha256 ||
      (await tx.sha256(registry.REGISTRY)) !== row.request.registrySha256 ||
      (await tx.sha256(ideationAuthorManifest)) !== row.request.manifestSha256
    )
      ideationFail("PREVIEW_STALE");
    return compilationSources(tx, actor, row.request);
  }
  private async generationPreview(
    tx: IdeationTransaction,
    actor: IdeationActor,
    task: IdeationTask,
    result: RoleResult,
  ) {
    const compiled = await this.compilationContext(tx, actor, task.id),
      output = result.output;
    if (
      typeof output !== "object" ||
      typeof output.generation_field !== "string" ||
      checks.projectionErrors(output.generation_field).length ||
      output.chapter !== compiled.chapter ||
      ideationDigest(output.scope) !== ideationDigest(compiled.scope)
    )
      ideationFail("OUTPUT_BLOCKED");
    for (const key of ["locked_events", "locked_order"] as const)
      if (
        !Array.isArray(output[key]) ||
        output[key].some(
          (v) => !(compiled.input[key] as string[]).includes(v as string),
        )
      )
        ideationFail("OUTPUT_BLOCKED");
    const revision =
      (
        await tx.sql<{ session_revision: number }>(
          "SELECT session_revision FROM ideation_tasks WHERE run_id=$1",
          [task.id],
        )
      ).rows[0]?.session_revision ?? ideationFail("NOT_FOUND");
    return this.savePreview(tx, actor, task, {
      id: randomUUID(),
      projectId: actor.projectId,
      sessionId: task.sessionId,
      taskId: task.id,
      sessionRevision: revision,
      revision: 1,
      supersedesPreviewId: null,
      createdAt: new Date().toISOString(),
      kind: "generation_field",
      role: "zhangjie-qingjing-bianyiyuan",
      summary: "请审阅当前章节情境。",
      scope: compiled.scope,
      resources: compiled.resources,
      approvedSources: compiled.resources,
      registrySha256: compiled.registrySha256,
      chapter: compiled.chapter,
      generationField: output.generation_field,
      characterCount: Array.from(output.generation_field).length,
      lockedEvents: output.locked_events,
      lockedOrder: output.locked_order,
      projection: fileRef(
        `authoring-ruwen-v5/projections/ideation-${task.id}.md`,
        output.generation_field,
      ),
    } as unknown as Omit<IdeationGenerationFieldPreview, "status" | "sha256">);
  }
  private async commitGeneration(
    tx: IdeationTransaction,
    actor: IdeationActor,
    preview: IdeationGenerationFieldPreview,
  ) {
    await this.compilationContext(tx, actor, preview.taskId);
    if (
      checks.projectionErrors(preview.generationField).length ||
      preview.characterCount !== Array.from(preview.generationField).length ||
      previewBytesHash(preview.generationField) !== preview.projection.sha256
    )
      ideationFail("PREVIEW_STALE");
    await tx.createExclusive(preview.projection.path, preview.generationField);
    const promises = evidenceBytes({
      projection_sha256: preview.projection.sha256,
      locked_events: preview.lockedEvents,
      locked_order: preview.lockedOrder,
    });
    await tx.createExclusive(
      `${preview.projection.path}.promises.json`,
      promises,
    );
    await state.registerProjection(
      tx,
      preview.projection.path,
      preview.chapter,
      preview.scope,
    );
    const manifest = JSON.parse(await tx.readText(ideationAuthorManifest));
    manifest.projection = preview.projection.path;
    manifest.context_scope = preview.scope;
    await tx.write(ideationAuthorManifest, evidenceBytes(manifest));
    return {
      coreApprovals: [],
      startedTaskId: null,
      projectionRegistered: true,
      committedFiles: [
        preview.projection,
        fileRef(`${preview.projection.path}.promises.json`, promises),
        fileRef(
          `${preview.projection.path}.meta.json`,
          await tx.readText(`${preview.projection.path}.meta.json`),
        ),
        fileRef(state.STATE, await tx.readText(state.STATE)),
        fileRef(
          ideationAuthorManifest,
          await tx.readText(ideationAuthorManifest),
        ),
      ],
    };
  }
}

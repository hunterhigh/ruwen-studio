import { randomUUID } from "node:crypto";
import {
  approval,
  ledgers,
  type ProjectFS,
  packet,
  registry,
  state,
} from "@ruwen/core";
import { previewBytesHash } from "./backend.ts";
import { ideationAuthorManifest } from "./compilation.ts";
import type {
  IdeationActor,
  IdeationApprovalReceipt,
  IdeationContextScope,
  IdeationCoreApprovalRef,
  IdeationDecisionId,
  IdeationServiceV1_2,
  IdeationSha256,
  IdeationVerbatimPreview,
} from "./contract.ts";
import { exactBindingPath, exactTextDirectory } from "./exact-text.ts";
import { resourceMetadata, writablePath } from "./file-patches.ts";
import { previewFS } from "./preview-fs.ts";
import {
  appendIdeationEvent,
  exactIdeationRequest,
  ideationFail,
  ideationHash,
  ideationText,
  ideationUuid,
  ownedSession,
} from "./sessions.ts";
import type { IdeationServiceBackend } from "./specialized.ts";
import type { IdeationTransaction } from "./store.ts";

type Stored = Omit<IdeationVerbatimPreview, "status" | "sha256"> & {
  _stateSha256: string | null;
};
const statePath = "authoring-ruwen-v5/state.json";
export class VerbatimPreviews {
  readonly backend: IdeationServiceBackend;
  constructor(backend: IdeationServiceBackend) {
    this.backend = backend;
  }
  async source(tx: IdeationTransaction, actor: IdeationActor, id: string) {
    if (!ideationUuid.test(id)) ideationFail("NOT_FOUND");
    const row = (
      await tx.sql<{
        id: string;
        session_id: string;
        role: string;
        content: string;
      }>(
        "SELECT id,session_id,role,content FROM ideation_messages WHERE id=$1 AND project_id=$2",
        [id, actor.projectId],
      )
    ).rows[0];
    if (!row) ideationFail("NOT_FOUND");
    await ownedSession(tx, actor, row.session_id);
    if (row.role !== "user" || typeof row.content !== "string")
      ideationFail("INVALID_ARGUMENT");
    return row;
  }
  async resource(tx: IdeationTransaction, id: unknown) {
    const data = await registry.readRegistry(tx);
    const resource = data.resources.find((r) => r.id === id);
    if (!resource) ideationFail("NOT_FOUND");
    return resource;
  }
  writable(tx: IdeationTransaction, r: registry.Resource) {
    writablePath(tx, r.path, r.type);
    if (
      ["retired", "superseded"].includes(r.status) ||
      (r.type === "expression" && r.status === "active")
    )
      ideationFail("READERS_DENIED");
  }
  async fresh(
    tx: IdeationTransaction,
    actor: IdeationActor,
    p: IdeationVerbatimPreview,
    guard: string | null,
  ) {
    const source = await this.source(tx, actor, p.source.messageId);
    if (
      source.session_id !== p.sessionId ||
      previewBytesHash(source.content) !== p.source.messageSha256 ||
      Array.from(source.content)
        .slice(p.source.start, p.source.end)
        .join("") !== p.text ||
      previewBytesHash(p.text) !== p.textSha256
    )
      ideationFail("PREVIEW_STALE");
    if (
      !(await tx.exists(registry.REGISTRY)) ||
      (await tx.sha256(registry.REGISTRY)) !== p.registrySha256
    )
      ideationFail("RESOURCE_STALE");
    if (p.target.kind === "resource_file") {
      const r = await this.resource(tx, p.target.resource.id);
      this.writable(tx, r);
      if (
        r.path !== p.target.resource.path ||
        r.source_sha256 !== p.target.resource.sha256 ||
        !(await tx.exists(r.path)) ||
        (await tx.sha256(r.path)) !== r.source_sha256
      )
        ideationFail("RESOURCE_STALE");
    } else {
      if (
        !guard ||
        !(await tx.exists(statePath)) ||
        !(await tx.exists(p.target.manifest.path)) ||
        (await tx.sha256(statePath)) !== guard ||
        (await tx.sha256(p.target.manifest.path)) !==
          p.target.manifest.sha256 ||
        (await tx.exists(p.target.file.path))
      )
        ideationFail("PREVIEW_STALE");
      if (
        p.target.previousExactText &&
        (!(await tx.exists(p.target.previousExactText.path)) ||
          (await tx.sha256(p.target.previousExactText.path)) !==
            p.target.previousExactText.sha256)
      )
        ideationFail("RESOURCE_STALE");
    }
  }
  async owned(tx: IdeationTransaction, actor: IdeationActor, id: string) {
    if (!ideationUuid.test(id)) ideationFail("NOT_FOUND");
    const row = (
      await tx.sql<{
        snapshot: string;
        sha256: string;
        status: IdeationVerbatimPreview["status"];
      }>(
        "SELECT snapshot,sha256,status FROM ideation_previews WHERE id=$1 AND project_id=$2 AND kind='verbatim' FOR UPDATE",
        [id, actor.projectId],
      )
    ).rows[0];
    if (!row) ideationFail("NOT_FOUND");
    if (previewBytesHash(row.snapshot) !== row.sha256)
      ideationFail("PREVIEW_STALE");
    const { _stateSha256, ...snapshot } = JSON.parse(row.snapshot) as Stored;
    const p = {
      ...snapshot,
      sha256: row.sha256,
      status: row.status,
    } as IdeationVerbatimPreview;
    await ownedSession(tx, actor, p.sessionId);
    if (
      p.id !== id ||
      p.projectId !== actor.projectId ||
      p.taskId !== null ||
      p.origin !== "user_explicit" ||
      p.kind !== "verbatim"
    )
      ideationFail("NOT_FOUND");
    if (p.status === "pending") {
      try {
        await this.fresh(tx, actor, p, _stateSha256);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !["PREVIEW_STALE", "RESOURCE_STALE"].includes(error.message)
        )
          throw error;
        await tx.sql(
          "UPDATE ideation_previews SET status='stale' WHERE id=$1",
          [id],
        );
        await appendIdeationEvent(tx, actor, p.sessionId, null, {
          type: "preview_changed",
          previewId: p.id,
          status: "stale",
          sha256: p.sha256,
        });
        return {
          preview: { ...p, status: "stale" as const },
          guard: _stateSha256,
        };
      }
    }
    return { preview: p, guard: _stateSha256 };
  }
  async compile(
    tx: ProjectFS,
    p: Pick<IdeationVerbatimPreview, "target" | "text">,
  ) {
    if (p.target.kind !== "current_chapter") ideationFail("INVALID_ARGUMENT");
    await tx.createExclusive(p.target.file.path, p.text);
    const manifest = JSON.parse(await tx.readText(p.target.manifest.path));
    manifest.user_authored_text = {
      path: p.target.file.path,
      confirmed_verbatim: true,
    };
    await tx.write(
      p.target.manifest.path,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    try {
      await packet.compilePacket(tx, p.target.manifest.path);
    } catch (error) {
      if (
        error instanceof Error &&
        /exceeds|maximum context/.test(error.message)
      )
        ideationFail("INPUT_LIMIT_EXCEEDED");
      ideationFail("PRECONDITION_FAILED");
    }
  }
  create: IdeationServiceV1_2["createVerbatimPreview"] = (actor, request) =>
    this.backend.call(actor, async (tx) => {
      const source = await this.source(tx, actor, request.messageId);
      const target = request.target;
      if (
        !target ||
        typeof target !== "object" ||
        !["resource_file", "current_chapter"].includes(target.kind)
      )
        ideationFail("INVALID_ARGUMENT");
      // Resolve every supplied locator before validating selection, state or idempotence.
      const resource =
        target.kind === "resource_file"
          ? await this.resource(tx, target.resourceId)
          : null;
      exactIdeationRequest(request, [
        "messageId",
        "start",
        "end",
        "target",
        "clientRequestId",
      ]);
      exactIdeationRequest(
        target,
        target.kind === "resource_file" ? ["kind", "resourceId"] : ["kind"],
      );
      const points = Array.from(source.content);
      if (
        !Number.isSafeInteger(request.start) ||
        !Number.isSafeInteger(request.end) ||
        request.start < 0 ||
        request.end <= request.start ||
        request.end > points.length
      )
        ideationFail("INVALID_ARGUMENT");
      if (resource) this.writable(tx, resource);
      return this.backend.mutate(
        tx,
        actor,
        "createVerbatimPreview",
        request,
        async () => {
          const text = points.slice(request.start, request.end).join("");
          const session = await ownedSession(tx, actor, source.session_id);
          const key =
            (
              await tx.sql<{ project_key: string }>(
                "SELECT project_key FROM projects WHERE id=$1",
                [actor.projectId],
              )
            ).rows[0]?.project_key ?? ideationFail("NOT_FOUND");
          const id = randomUUID();
          let scope: IdeationContextScope = {
            project: key,
            volume: null,
            arc: null,
            chapter: null,
            scene_type: null,
            pov: null,
          } as IdeationContextScope;
          let destination: IdeationVerbatimPreview["target"],
            guard: string | null = null;
          if (resource) {
            if (
              resource.scope.project !== null &&
              resource.scope.project !== key
            )
              ideationFail("READERS_DENIED");
            if ((await registry.validateRegistry(tx)).errors.length)
              ideationFail("PRECONDITION_FAILED");
            const before = await tx.readText(resource.path),
              separator = before && !before.endsWith("\n") ? "\n" : "";
            destination = {
              kind: "resource_file",
              resource: resourceMetadata(resource),
              writeMode: "append",
              separator,
              afterSha256: previewBytesHash(
                before + separator + text,
              ) as IdeationSha256,
            };
          } else {
            if (points.slice(request.start, request.end).length > 600)
              ideationFail("INPUT_LIMIT_EXCEEDED");
            const current = await state.loadState(tx),
              manifest = JSON.parse(await tx.readText(ideationAuthorManifest));
            const active = current.active_projection;
            if (
              !active ||
              typeof active !== "object" ||
              Array.isArray(active) ||
              !active.context_scope ||
              typeof active.chapter !== "string" ||
              (await state.computeStatus(tx, current)).ready_to_compile !== true
            )
              ideationFail("PRECONDITION_FAILED");
            scope = active.context_scope as unknown as IdeationContextScope;
            if (scope.project !== key || scope.chapter !== active.chapter)
              ideationFail("PRECONDITION_FAILED");
            const file = `${exactTextDirectory}v12-${active.chapter}-${id}.md`,
              previous = manifest.user_authored_text?.path;
            if (
              previous &&
              (!String(previous).startsWith(exactTextDirectory) ||
                tx.path(previous) !== previous)
            )
              ideationFail("PRECONDITION_FAILED");
            destination = {
              kind: "current_chapter",
              chapter: active.chapter,
              file: { path: file, sha256: previewBytesHash(text) },
              manifest: {
                path: ideationAuthorManifest,
                sha256: await tx.sha256(ideationAuthorManifest),
              },
              previousExactText: previous
                ? { path: previous, sha256: await tx.sha256(previous) }
                : null,
              maximumCharacters: 600,
              maximumPacketCharacters:
                manifest.maximum_context_characters ?? 8000,
            } as IdeationVerbatimPreview["target"];
            guard = await tx.sha256(statePath);
            await this.compile(previewFS(tx), {
              target: destination,
              text: text as never,
            });
          }
          const stored = {
            id,
            projectId: actor.projectId,
            sessionId: source.session_id,
            taskId: null,
            sessionRevision: session.revision,
            supersedesPreviewId: null,
            revision: 1,
            kind: "verbatim",
            origin: "user_explicit",
            role: "chuangyi-xietiaoyuan",
            summary: "请确认所选文字与写入目标。",
            scope,
            resources: resource ? [resourceMetadata(resource)] : [],
            registrySha256: await tx.sha256(registry.REGISTRY),
            createdAt: new Date().toISOString(),
            source: {
              messageId: source.id,
              start: request.start,
              end: request.end,
              messageSha256: previewBytesHash(source.content),
            },
            text,
            textSha256: previewBytesHash(text),
            characterCount: Array.from(text).length,
            target: destination,
            _stateSha256: guard,
          } as unknown as Stored;
          const bytes = JSON.stringify(stored),
            sha = previewBytesHash(bytes);
          await tx.sql(
            "INSERT INTO ideation_previews(id,project_id,session_id,task_id,kind,snapshot,sha256) VALUES($1,$2,$3,NULL,'verbatim',$4,$5)",
            [id, actor.projectId, source.session_id, bytes, sha],
          );
          const { _stateSha256, ...visible } = stored;
          const preview = {
            ...visible,
            status: "pending",
            sha256: sha,
          } as IdeationVerbatimPreview;
          await appendIdeationEvent(tx, actor, preview.sessionId, null, {
            type: "preview_changed",
            previewId: preview.id,
            status: "pending",
            sha256: preview.sha256,
          });
          return preview;
        },
      );
    });
  approve: IdeationServiceV1_2["approvePreview"] = (actor, request) =>
    this.backend.call(actor, async (tx) => {
      const { preview: p, guard } = await this.owned(
        tx,
        actor,
        request.previewId,
      );
      exactIdeationRequest(request, [
        "previewId",
        "clientRequestId",
        "expectedSha256",
        "confirmed",
      ]);
      if (request.confirmed !== true) ideationFail("APPROVAL_REQUIRED");
      ideationHash(request.expectedSha256);
      return this.backend.mutate(
        tx,
        actor,
        "approvePreview",
        request,
        async () => {
          if (p.status !== "pending")
            ideationFail(
              p.status === "stale" ? "PREVIEW_STALE" : "ALREADY_DECIDED",
            );
          if (p.sha256 !== request.expectedSha256)
            ideationFail("PREVIEW_STALE");
          await this.fresh(tx, actor, p, guard);
          const id = randomUUID() as IdeationDecisionId;
          let committedFiles: IdeationApprovalReceipt["committedFiles"];
          const coreApprovals: IdeationCoreApprovalRef[] = [];
          if (p.target.kind === "resource_file") {
            const r = await this.resource(tx, p.target.resource.id),
              after = (await tx.readText(r.path)) + p.target.separator + p.text;
            if (previewBytesHash(after) !== p.target.afterSha256)
              ideationFail("PREVIEW_STALE");
            await tx.write(r.path, after);
            const eventId = `verbatim-${id}`;
            const created = await approval.createEvent(
              tx,
              eventId,
              "resource_activate",
              r.path,
              true,
            );
            const eventPath = String(created.event),
              event = JSON.parse(await tx.readText(eventPath)),
              eventSha = await tx.sha256(eventPath);
            await approval.consumeEvent(tx, event, p.role);
            const data = await registry.readRegistry(tx),
              changed =
                data.resources.find((item) => item.id === r.id) ??
                ideationFail("NOT_FOUND");
            changed.source_sha256 = p.target.afterSha256;
            if (changed.type === "expression" && changed.status === "candidate")
              changed.status = "proposed";
            changed.approval = {
              status: "approved",
              approved_at: event.approved_at,
              approved_by: "user",
              approval_event_path: eventPath,
              approval_event_sha256: eventSha,
            };
            await tx.write(
              registry.REGISTRY,
              `${JSON.stringify(data, null, 2)}\n`,
            );
            if ((await registry.validateRegistry(tx)).errors.length)
              ideationFail("PRECONDITION_FAILED");
            coreApprovals.push({
              id: eventId,
              path: eventPath,
              sha256: eventSha,
              action: "resource_activate",
              target: { path: r.path, sha256: p.target.afterSha256 },
            } as IdeationCoreApprovalRef);
            committedFiles = [
              { path: p.target.resource.path, sha256: p.target.afterSha256 },
            ];
          } else {
            await this.compile(tx, p);
            await tx.createExclusive(
              exactBindingPath(p.target.file.path),
              `${JSON.stringify({ version: 1, chapter: p.target.chapter, path: p.target.file.path, sha256: p.textSha256, active: true })}\n`,
            );
            committedFiles = [
              p.target.file,
              {
                path: p.target.manifest.path,
                sha256: (await tx.sha256(
                  p.target.manifest.path,
                )) as IdeationSha256,
              },
            ];
          }
          const receipt = {
            id,
            projectId: actor.projectId,
            previewId: p.id,
            approvedSha256: p.sha256,
            coreApprovals,
            startedTaskId: null,
            committedFiles,
            projectionRegistered: false,
            createdAt: new Date().toISOString(),
          } as IdeationApprovalReceipt;
          await tx.sql(
            "INSERT INTO ideation_decisions(id,project_id,session_id,preview_id,receipt) VALUES($1,$2,$3,$4,$5)",
            [id, actor.projectId, p.sessionId, p.id, JSON.stringify(receipt)],
          );
          await tx.sql(
            "UPDATE ideation_previews SET status='approved' WHERE id=$1",
            [p.id],
          );
          if (p.target.kind === "resource_file")
            await tx.sql(
              "INSERT INTO ideation_published_selections(preview_id,decision_id,project_id,session_id,message_id,start_position,end_position,message_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                p.id,
                id,
                actor.projectId,
                p.sessionId,
                p.source.messageId,
                p.source.start,
                p.source.end,
                p.source.messageSha256,
              ],
            );
          await tx.createExclusive(
            `治理/构思决定/${id}.json`,
            `${JSON.stringify(receipt)}\n`,
          );
          await ledgers.appendAudit(tx, {
            role: p.role,
            resource_ids: p.resources.map((r) => r.id),
            change: "verbatim_preview_committed",
            scope: {
              project: p.scope.project,
              volume: p.scope.volume,
              arc: p.scope.arc,
              chapter: p.scope.chapter,
            },
            conflict_category: null,
            approval_status: "approved",
            result: "committed",
          });
          await appendIdeationEvent(tx, actor, p.sessionId, null, {
            type: "preview_changed",
            previewId: p.id,
            status: "approved",
            sha256: p.sha256,
          });
          await appendIdeationEvent(tx, actor, p.sessionId, null, {
            type: "approval_committed",
            previewId: p.id,
            decisionId: receipt.id,
          });
          return receipt;
        },
      );
    });
  reject: IdeationServiceV1_2["rejectPreview"] = (actor, request) =>
    this.backend.call(actor, async (tx) => {
      const { preview: p } = await this.owned(tx, actor, request.previewId);
      exactIdeationRequest(request, [
        "previewId",
        "clientRequestId",
        "expectedSha256",
        "reason",
      ]);
      ideationHash(request.expectedSha256);
      if (request.reason !== undefined) ideationText(request.reason);
      return this.backend.mutate(
        tx,
        actor,
        "rejectPreview",
        request,
        async () => {
          if (p.status !== "pending") ideationFail("ALREADY_DECIDED");
          if (p.sha256 !== request.expectedSha256)
            ideationFail("PREVIEW_STALE");
          let messageId: string | null = null;
          if (request.reason !== undefined) {
            messageId = randomUUID();
            const session = await ownedSession(tx, actor, p.sessionId);
            await tx.sql(
              "INSERT INTO ideation_messages(id,project_id,session_id,role,content,session_revision) VALUES($1,$2,$3,'user',$4,$5)",
              [
                messageId,
                actor.projectId,
                p.sessionId,
                JSON.stringify(request.reason),
                session.revision + 1,
              ],
            );
            await tx.sql(
              "UPDATE ideation_sessions SET revision=revision+1,updated_at=now() WHERE id=$1",
              [p.sessionId],
            );
          }
          await tx.sql(
            "UPDATE ideation_previews SET status='rejected' WHERE id=$1",
            [p.id],
          );
          await appendIdeationEvent(tx, actor, p.sessionId, null, {
            type: "preview_changed",
            previewId: p.id,
            status: "rejected",
            sha256: p.sha256,
          });
          return {
            previewId: p.id,
            status: "rejected",
            coordinatorMessageId: messageId as never,
          };
        },
      );
    });
}

/**
 * Ideation service v1 — CONTRACT ONLY. No runtime exports or service implementation.
 * Import with `import type ... from "@ruwen/pipeline"`; docs/contracts/ideation-service.md
 * defines runtime validation, ownership, hashing, privacy and transaction requirements.
 */
import type { AttemptResetReason, RoleId } from "@ruwen/agents";

type Opaque<Tag extends string> = string & { readonly __ideationType: Tag };
export type IdeationProjectId = Opaque<"project-uuid">;
export type IdeationUserId = Opaque<"user-uuid">;
export type IdeationSessionId = Opaque<"session-uuid">;
export type IdeationMessageId = Opaque<"message-uuid">;
/** Coordinator turn IDs and downstream task IDs are pipeline run UUIDs. */
export type IdeationRunId = Opaque<"run-uuid">;
export type IdeationPreviewId = Opaque<"preview-uuid">;
export type IdeationDecisionId = Opaque<"decision-uuid">;
export type IdeationRequestId = Opaque<"idempotency-uuid">;
export type IdeationResourceId = Opaque<"registry-resource-id">;
export type IdeationCoreApprovalId = Opaque<"core-approval-id">;
export type IdeationProjectKey = Opaque<"upstream-project-key">;
export type IdeationProjectPath = Opaque<"project-relative-path">;
export type IdeationSha256 = Opaque<"sha256">;
export type IdeationCursor = Opaque<"decimal-cursor">;
/** Certification by server validation, NOT a sanitizer or permission granted by a TS cast. */
export type IdeationSafeText = Opaque<"system-and-raw-source-checked-text">;
export type IdeationTime = string; // ISO 8601 UTC

export type IdeationDispatchRole =
  | "xiangmu-zhiliyuan"
  | "waibu-zhishi-guwen"
  | "biaoxian-shejishi"
  | "gushi-gousishi";
export type IdeationDownstreamRole =
  | IdeationDispatchRole
  | "zhangjie-qingjing-bianyiyuan";
export type IdeationRole = "chuangyi-xietiaoyuan" | IdeationDownstreamRole;
export type IdeationResourceStatus =
  | "proposed"
  | "candidate"
  | "active"
  | "superseded"
  | "retired";
export type IdeationResourceType =
  | "governance"
  | "character"
  | "world"
  | "story"
  | "evidence"
  | "expression"
  | "validation";
export interface IdeationContextScope {
  readonly project: IdeationProjectKey;
  readonly volume: string | null;
  readonly arc: string | null;
  readonly chapter: string | null;
  readonly scene_type: string | null;
  readonly pov: string | null;
}
/** Registry scope has PLURAL array dimensions, unlike a context scope. */
export interface IdeationResourceScope {
  readonly project: IdeationProjectKey | null;
  readonly volumes: readonly string[] | null;
  readonly arcs: readonly string[] | null;
  readonly chapters: readonly string[] | null;
  readonly scene_types: readonly string[] | null;
  readonly povs: readonly string[] | null;
}
export interface IdeationFileRef {
  readonly path: IdeationProjectPath;
  readonly sha256: IdeationSha256;
}
export interface IdeationResourceRef extends IdeationFileRef {
  readonly id: IdeationResourceId;
  readonly type: IdeationResourceType;
  readonly status: IdeationResourceStatus;
  readonly scope: IdeationResourceScope;
}
export interface IdeationResourceMetadata extends IdeationResourceRef {
  readonly owner: string;
  readonly version: string;
  readonly readers: readonly RoleId[];
  readonly allowAuthor: boolean;
  readonly supersedes: IdeationResourceId | null;
}
export interface IdeationResourceChange {
  readonly resourceId: IdeationResourceId;
  readonly before: IdeationResourceMetadata | null;
  readonly after: IdeationResourceMetadata;
}
export interface IdeationSectionPatch {
  readonly kind: "sections";
  readonly resource: IdeationResourceRef;
  readonly sections: readonly {
    readonly heading: IdeationSafeText;
    readonly replacement: IdeationSafeText;
  }[];
  /** Computed by the server from the exact base; never trusted as client-authored replacements. */
  readonly beforeText: IdeationSafeText;
  readonly afterText: IdeationSafeText;
  readonly afterSha256: IdeationSha256;
}
export interface IdeationNewFilePatch {
  readonly kind: "create";
  readonly resourceId: IdeationResourceId;
  readonly path: IdeationProjectPath;
  readonly baseSha256: null;
  readonly content: IdeationSafeText;
  readonly afterSha256: IdeationSha256;
}
export type IdeationFilePatch = IdeationSectionPatch | IdeationNewFilePatch;

export type IdeationExcludedSource =
  | "raw_user_wording"
  | "example"
  | "complaint_language"
  | "correction_history"
  | "implementation_route"
  | "approval_dialogue"
  | "unused_option";
export interface IdeationCreativePayload {
  readonly fixed: readonly IdeationSafeText[];
  readonly creative_value: IdeationSafeText;
  readonly unresolved_forces: readonly IdeationSafeText[];
  readonly open_realization: readonly IdeationSafeText[];
  readonly destination: IdeationSafeText;
  readonly excluded_source: readonly IdeationExcludedSource[];
}
export interface IdeationConsultantPayload {
  readonly known: IdeationSafeText;
  readonly unknown: IdeationSafeText;
  readonly learning_goal: IdeationSafeText;
  readonly boundary: IdeationSafeText;
  readonly allowed_sources: readonly IdeationSafeText[];
  readonly destination: IdeationSafeText;
}
interface IdeationHandoffBase {
  readonly sender: "chuangyi-xietiaoyuan";
  readonly resource_ids: readonly IdeationResourceId[];
  readonly scope: Partial<IdeationContextScope> &
    Pick<IdeationContextScope, "project">;
  readonly approval_ref: null;
}
/** App's four dispatch targets are a SUBSET of upstream's creative_brief whitelist.
 * Compiler requests use requestIdeationCompilation, never an invented handoff recipient. */
export type IdeationCleanHandoff = IdeationHandoffBase &
  (
    | {
        readonly kind: "creative_brief";
        readonly recipient: IdeationDispatchRole;
        readonly payload: IdeationCreativePayload;
      }
    | {
        readonly kind: "consultant_brief";
        readonly recipient: "waibu-zhishi-guwen";
        readonly payload: IdeationConsultantPayload;
      }
  );
export type IdeationPreviewStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "stale"
  | "superseded";
interface IdeationPreviewBase {
  readonly id: IdeationPreviewId;
  readonly projectId: IdeationProjectId;
  readonly sessionId: IdeationSessionId;
  readonly taskId: IdeationRunId;
  readonly sessionRevision: number;
  readonly supersedesPreviewId: IdeationPreviewId | null;
  readonly revision: number;
  /** Server-owned immutable executable preview snapshot, excluding mutable status. */
  readonly sha256: IdeationSha256;
  readonly status: IdeationPreviewStatus;
  readonly summary: IdeationSafeText;
  readonly scope: IdeationContextScope;
  readonly resources: readonly IdeationResourceRef[];
  readonly registrySha256: IdeationSha256;
  readonly createdAt: IdeationTime;
}
export interface IdeationHandoffPreview extends IdeationPreviewBase {
  readonly kind: "handoff";
  readonly role: "chuangyi-xietiaoyuan";
  readonly handoff: IdeationCleanHandoff;
  readonly understanding: {
    readonly creativeValue: IdeationSafeText;
    readonly fixedFacts: readonly IdeationSafeText[];
    readonly openChoices: readonly IdeationSafeText[];
    readonly exampleTreatment: IdeationSafeText;
    readonly destination: IdeationSafeText;
  };
  /** Hash of the standalone payload targeted by core.handoff's execution approval. */
  readonly payloadSha256: IdeationSha256;
}
export interface IdeationFilePreview extends IdeationPreviewBase {
  readonly kind: "file_patch";
  readonly role: Exclude<IdeationDispatchRole, "biaoxian-shejishi">;
  readonly explanation: IdeationSafeText;
  readonly patches: readonly IdeationFilePatch[];
  readonly registryChanges: readonly IdeationResourceChange[];
}
export interface IdeationLearningPlanPreview extends IdeationPreviewBase {
  readonly kind: "learning_plan";
  readonly role: "waibu-zhishi-guwen";
  readonly known: IdeationSafeText;
  readonly unknown: IdeationSafeText;
  readonly plan: readonly IdeationSafeText[];
  readonly boundary: IdeationSafeText;
  readonly potentialConflicts: readonly IdeationSafeText[];
  readonly destination: IdeationSafeText;
  readonly sourceMode: "existing_materials" | "external_search";
  /** Reuses the existing consultant_brief + handoff_execute gate for investigation. */
  readonly execution: Extract<
    IdeationCleanHandoff,
    { kind: "consultant_brief" }
  >;
}
export interface IdeationExpressionPreview extends IdeationPreviewBase {
  readonly kind: "expression_candidate";
  readonly role: "biaoxian-shejishi";
  readonly approvalStage: "candidate" | "activation";
  readonly resource: IdeationResourceRef & {
    readonly type: "expression";
    readonly status: "proposed" | "candidate";
  };
  readonly patches: readonly IdeationFilePatch[];
  readonly registryChanges: readonly IdeationResourceChange[];
  readonly closureAudit: {
    readonly status: "pending" | "passed" | "failed";
    readonly report: IdeationFileRef | null;
    readonly checks: readonly {
      readonly category:
        | "route"
        | "fulfillment"
        | "mapping"
        | "anchoring"
        | "density"
        | "proximity";
      readonly risk: "low" | "medium" | "high";
      readonly resolved: boolean;
      readonly summary: IdeationSafeText;
    }[];
  };
  readonly trial: {
    readonly status: "pending" | "passed" | "failed";
    readonly report: IdeationFileRef | null;
    readonly sample: IdeationSafeText | null;
    readonly nonCanonical: true;
  };
}
export interface IdeationGenerationFieldPreview extends IdeationPreviewBase {
  readonly kind: "generation_field";
  readonly role: "zhangjie-qingjing-bianyiyuan";
  readonly chapter: string;
  readonly generationField: IdeationSafeText;
  readonly characterCount: number; // server-computed Unicode codepoints, <= 2200
  readonly lockedEvents: readonly IdeationSafeText[];
  readonly lockedOrder: readonly IdeationSafeText[];
  readonly projection: IdeationFileRef;
  readonly approvedSources: readonly IdeationResourceRef[];
}
export type IdeationPreview =
  | IdeationHandoffPreview
  | IdeationFilePreview
  | IdeationLearningPlanPreview
  | IdeationExpressionPreview
  | IdeationGenerationFieldPreview;

export interface IdeationSession {
  readonly id: IdeationSessionId;
  readonly projectId: IdeationProjectId;
  readonly title: string; // coordinator workspace only; never copied to downstream events
  readonly status: "open" | "closed";
  readonly revision: number;
  readonly currentTurnId: IdeationRunId | null;
  readonly capabilities: {
    readonly externalSearch: boolean;
    readonly modelMode: "faux" | "real" | "record" | "replay";
  };
  readonly createdAt: IdeationTime;
  readonly updatedAt: IdeationTime;
}
/** The ONLY DTO containing raw user wording. Accessible only via the coordinator session. */
export interface IdeationMessage {
  readonly id: IdeationMessageId;
  readonly projectId: IdeationProjectId;
  readonly sessionId: IdeationSessionId;
  readonly turnId: IdeationRunId | null;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly status: "complete" | "streaming" | "failed";
  readonly createdAt: IdeationTime;
}
export type IdeationTaskStatus =
  | "QUEUED"
  | "RUNNING"
  | "AWAITING_PREVIEW_APPROVAL"
  | "AWAITING_LEARNING_PLAN_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "INTERRUPTED";
export interface IdeationTask {
  readonly id: IdeationRunId;
  readonly projectId: IdeationProjectId;
  readonly sessionId: IdeationSessionId;
  readonly role: IdeationRole;
  readonly stage:
    | "coordinator"
    | "governance"
    | "learning_plan"
    | "research"
    | "expression"
    | "story"
    | "compilation";
  readonly status: IdeationTaskStatus;
  readonly sourcePreviewId: IdeationPreviewId | null;
  readonly outputPreviewIds: readonly IdeationPreviewId[];
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheReadTokens: number;
    readonly cacheWriteTokens: number;
    readonly costUsd: string | null;
  };
  readonly error: IdeationError | null;
  readonly createdAt: IdeationTime;
  readonly finishedAt: IdeationTime | null;
}
export type IdeationErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "CSRF_INVALID"
  | "INVALID_ARGUMENT"
  | "INPUT_LIMIT_EXCEEDED"
  | "TURN_IN_PROGRESS"
  | "SESSION_CLOSED"
  | "CREATION_CHECK_FAILED"
  | "READERS_DENIED"
  | "RESOURCE_STALE"
  | "PREVIEW_STALE"
  | "ALREADY_DECIDED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_CONSUMED"
  | "IDEMPOTENCY_CONFLICT"
  | "SEARCH_UNAVAILABLE"
  | "CLOSURE_AUDIT_REQUIRED"
  | "NONCANONICAL_TRIAL_REQUIRED"
  | "PRECONDITION_FAILED"
  | "OUTPUT_BLOCKED"
  | "CANCELLED"
  | "INTERRUPTED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "INTERNAL_ERROR";
export interface IdeationError {
  readonly code: IdeationErrorCode;
  readonly message: IdeationSafeText; // approved public copy, never error.message from a provider
  readonly retryable: boolean;
  readonly traceId: string; // correlation only, not a resource locator
  readonly issues: readonly {
    readonly field: string;
    readonly rule:
      | "required"
      | "format"
      | "length"
      | "scope"
      | "hash"
      | "overlap"
      | "forbidden";
  }[];
}
export type IdeationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: IdeationError };
export interface IdeationPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: IdeationCursor | null;
}
export interface IdeationPageRequest {
  readonly after?: IdeationCursor;
  readonly limit?: number;
}
/** Built by authenticated server code; never populated from a request body. */
export interface IdeationActor {
  readonly userId: IdeationUserId;
  readonly projectId: IdeationProjectId;
}
interface IdeationMutation {
  readonly clientRequestId: IdeationRequestId;
}
export interface IdeationSendMessage extends IdeationMutation {
  readonly sessionId: IdeationSessionId;
  readonly expectedSessionRevision: number;
  readonly content: string;
}
export interface IdeationMessageAccepted {
  readonly sessionId: IdeationSessionId;
  readonly messageId: IdeationMessageId;
  readonly turnId: IdeationRunId;
  readonly sessionRevision: number;
}
export interface IdeationApprovePreview extends IdeationMutation {
  readonly previewId: IdeationPreviewId;
  readonly confirmed: true;
  readonly expectedSha256: IdeationSha256; // staleness hint only; server rehashes the authoritative snapshot
}
export interface IdeationCoreApprovalRef extends IdeationFileRef {
  readonly id: IdeationCoreApprovalId;
  readonly action:
    | "handoff_execute"
    | "resource_activate"
    | "expression_activate";
  readonly target: IdeationFileRef;
}
export interface IdeationApprovalReceipt {
  readonly id: IdeationDecisionId;
  readonly projectId: IdeationProjectId;
  readonly previewId: IdeationPreviewId;
  readonly approvedSha256: IdeationSha256;
  readonly coreApprovals: readonly IdeationCoreApprovalRef[];
  readonly startedTaskId: IdeationRunId | null;
  readonly committedFiles: readonly IdeationFileRef[];
  readonly projectionRegistered: boolean;
  readonly createdAt: IdeationTime;
}
export interface IdeationRejectPreview extends IdeationMutation {
  readonly previewId: IdeationPreviewId;
  readonly expectedSha256: IdeationSha256;
  readonly reason?: string; // stored ONLY as a coordinator message, never in the preview/event
}
export interface IdeationRevisePreview extends IdeationMutation {
  readonly previewId: IdeationPreviewId;
  readonly expectedSha256: IdeationSha256;
  readonly content: string; // coordinator-only new user message; never a direct patch to an approved preview
}
export interface IdeationCompilationRequest extends IdeationMutation {
  readonly sessionId: IdeationSessionId;
  readonly chapter: string;
  readonly scope: Omit<IdeationContextScope, "project" | "chapter">;
  readonly sources: readonly {
    readonly resourceId: IdeationResourceId;
    readonly expectedSha256: IdeationSha256;
  }[];
}
export interface IdeationActivateExpression extends IdeationApprovePreview {
  readonly resourceId: IdeationResourceId;
  readonly expectedResourceSha256: IdeationSha256;
  readonly trialReadConfirmed: true;
}
/** Same delta/reset data shape as the chapter stream; raw user messages are never event data. */
export type IdeationEventData =
  | {
      readonly type: "delta";
      readonly role: IdeationRole;
      readonly text: IdeationSafeText;
    }
  | {
      readonly type: "reset";
      readonly role: IdeationRole;
      readonly reason: AttemptResetReason;
    }
  | {
      readonly type: "message_changed";
      readonly messageId: IdeationMessageId;
      readonly turnId: IdeationRunId;
      readonly status: IdeationMessage["status"];
    }
  | {
      readonly type: "task_changed";
      readonly taskId: IdeationRunId;
      readonly status: IdeationTaskStatus;
    }
  | {
      readonly type: "preview_changed";
      readonly previewId: IdeationPreviewId;
      readonly status: IdeationPreviewStatus;
      readonly sha256: IdeationSha256;
    }
  | {
      readonly type: "approval_committed";
      readonly decisionId: IdeationDecisionId;
      readonly previewId: IdeationPreviewId;
    }
  | { readonly type: "error"; readonly error: IdeationError };
export type IdeationEvent = IdeationEventData & {
  readonly version: 1;
  readonly id: IdeationCursor;
  readonly projectId: IdeationProjectId;
  readonly sessionId: IdeationSessionId;
  readonly runId: IdeationRunId | null;
  readonly createdAt: IdeationTime;
};
export type IdeationOwnershipLocator =
  | {
      readonly projectId: IdeationProjectId;
      readonly sessionId: IdeationSessionId;
    }
  | {
      readonly projectId: IdeationProjectId;
      readonly sessionId: IdeationSessionId;
      readonly messageId: IdeationMessageId;
    }
  | { readonly projectId: IdeationProjectId; readonly runId: IdeationRunId }
  | {
      readonly projectId: IdeationProjectId;
      readonly previewId: IdeationPreviewId;
    }
  | {
      readonly projectId: IdeationProjectId;
      readonly decisionId: IdeationDecisionId;
    }
  | {
      readonly projectId: IdeationProjectId;
      readonly resourceId: IdeationResourceId;
    }
  | {
      readonly projectId: IdeationProjectId;
      readonly path: IdeationProjectPath;
    };

/** Signatures only: the main thread supplies typed mocks until this contract is merged. */
export interface IdeationService {
  createIdeationSession(
    actor: IdeationActor,
    request: IdeationMutation & { readonly title?: string },
  ): Promise<IdeationResult<IdeationSession>>;
  getIdeationSession(
    actor: IdeationActor,
    request: { readonly sessionId: IdeationSessionId },
  ): Promise<IdeationResult<IdeationSession>>;
  listIdeationMessages(
    actor: IdeationActor,
    request: IdeationPageRequest & { readonly sessionId: IdeationSessionId },
  ): Promise<IdeationResult<IdeationPage<IdeationMessage>>>;
  sendIdeationMessage(
    actor: IdeationActor,
    request: IdeationSendMessage,
  ): Promise<IdeationResult<IdeationMessageAccepted>>;
  listPreviews(
    actor: IdeationActor,
    request: IdeationPageRequest & {
      readonly sessionId: IdeationSessionId;
      readonly status?: IdeationPreviewStatus;
    },
  ): Promise<IdeationResult<IdeationPage<IdeationPreview>>>;
  getPreview(
    actor: IdeationActor,
    request: { readonly previewId: IdeationPreviewId },
  ): Promise<IdeationResult<IdeationPreview>>;
  approvePreview(
    actor: IdeationActor,
    request: IdeationApprovePreview,
  ): Promise<IdeationResult<IdeationApprovalReceipt>>;
  rejectPreview(
    actor: IdeationActor,
    request: IdeationRejectPreview,
  ): Promise<
    IdeationResult<{
      readonly previewId: IdeationPreviewId;
      readonly status: "rejected";
      readonly coordinatorMessageId: IdeationMessageId | null;
    }>
  >;
  revisePreview(
    actor: IdeationActor,
    request: IdeationRevisePreview,
  ): Promise<IdeationResult<IdeationMessageAccepted>>;
  activateExpression(
    actor: IdeationActor,
    request: IdeationActivateExpression,
  ): Promise<IdeationResult<IdeationApprovalReceipt>>;
  requestIdeationCompilation(
    actor: IdeationActor,
    request: IdeationCompilationRequest,
  ): Promise<IdeationResult<IdeationTask>>;
  listIdeationTasks(
    actor: IdeationActor,
    request: IdeationPageRequest & { readonly sessionId: IdeationSessionId },
  ): Promise<IdeationResult<IdeationPage<IdeationTask>>>;
  getIdeationTask(
    actor: IdeationActor,
    request: { readonly taskId: IdeationRunId },
  ): Promise<IdeationResult<IdeationTask>>;
  cancelIdeationTask(
    actor: IdeationActor,
    request: IdeationMutation & { readonly taskId: IdeationRunId },
  ): Promise<IdeationResult<IdeationTask>>;
  getIdeationApproval(
    actor: IdeationActor,
    request: { readonly decisionId: IdeationDecisionId },
  ): Promise<IdeationResult<IdeationApprovalReceipt>>;
  listIdeationEvents(
    actor: IdeationActor,
    request: IdeationPageRequest & { readonly sessionId: IdeationSessionId },
  ): Promise<IdeationResult<IdeationPage<IdeationEvent>>>;
}

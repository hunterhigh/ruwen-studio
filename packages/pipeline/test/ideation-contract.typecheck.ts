/** Compile-time consumer checks only. No service implementation or runtime exports. */
import type {
  IdeationActivateExpression,
  IdeationActor,
  IdeationApprovePreview,
  IdeationCleanHandoff,
  IdeationClosedSession,
  IdeationCloseSession,
  IdeationCompilationRequest,
  IdeationCoordinatorReplyText,
  IdeationCreateVerbatimPreview,
  IdeationErrorCode,
  IdeationEvent,
  IdeationEventV1_2,
  IdeationFilePreview,
  IdeationListSessions,
  IdeationPage,
  IdeationPageRequest,
  IdeationPreview,
  IdeationPreviewV1_2,
  IdeationRequestId,
  IdeationResult,
  IdeationService,
  IdeationServiceV1_2,
  IdeationSession,
  IdeationSessionId,
  IdeationSessionStatus,
  IdeationVerbatimPreview,
  IdeationVerbatimTarget,
  RunStartErrorCode,
  RunStartErrorStatus,
} from "../src/index.ts";

type Assert<T extends true> = T;
type Absent<T, K extends PropertyKey> = K extends keyof T ? false : true;
type IsNever<T> = [T] extends [never] ? true : false;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

export type CompilerIsNotAnInventedHandoffRecipient = Assert<
  IsNever<
    Extract<IdeationCleanHandoff, { recipient: "zhangjie-qingjing-bianyiyuan" }>
  >
>;
export type ApprovalHasNoClientSelectedOwner = Assert<
  Absent<IdeationApprovePreview, "ownerId">
>;
export type ApprovalHasNoClientSelectedCoreAction = Assert<
  Absent<IdeationApprovePreview, "action">
>;
export type CompilationDoesNotAcceptUserText = Assert<
  Absent<IdeationCompilationRequest, "content">
>;
export type FilePreviewDoesNotExposeConversation = Assert<
  Absent<IdeationFilePreview, "messages">
>;
export type ActivationRequiresExplicitTrialReading = Assert<
  IdeationActivateExpression["trialReadConfirmed"] extends true ? true : false
>;
export type ResetUsesTheSharedReasonCodes = Assert<
  Extract<IdeationEvent, { type: "reset" }>["reason"] extends
    | "format_correction"
    | "prompt_overlap_correction"
    | "security_refusal"
    ? true
    : false
>;
export type AllFivePreviewKindsAreAvailable = Assert<
  IsNever<
    Exclude<
      | "handoff"
      | "file_patch"
      | "learning_plan"
      | "expression_candidate"
      | "generation_field",
      IdeationPreview["kind"]
    >
  >
>;
export type SendMessageSignatureIsAsync = Assert<
  ReturnType<IdeationService["sendIdeationMessage"]> extends Promise<unknown>
    ? true
    : false
>;

export type SessionListUsesAuthenticatedActor = Assert<
  Equal<Parameters<IdeationService["listIdeationSessions"]>[0], IdeationActor>
>;
export type SessionListHasOptionalPagingAndStatus = Assert<
  Equal<
    IdeationListSessions,
    IdeationPageRequest & { readonly status?: IdeationSessionStatus }
  >
>;
export type SessionListAllowsOmittedFilters = Assert<
  Partial<IdeationListSessions> extends IdeationListSessions ? true : false
>;
export type SessionListStatusIsOnlyOpenOrClosed = Assert<
  Equal<IdeationListSessions["status"], "open" | "closed" | undefined>
>;
export type SessionListReturnsScopedSessionPage = Assert<
  Equal<
    ReturnType<IdeationService["listIdeationSessions"]>,
    Promise<IdeationResult<IdeationPage<IdeationSession>>>
  >
>;
export type CloseSessionHasExactlyTwoIdentifiers = Assert<
  Equal<keyof IdeationCloseSession, "sessionId" | "clientRequestId">
>;
export type CloseSessionIdentifierTypes = Assert<
  Equal<
    IdeationCloseSession,
    {
      readonly sessionId: IdeationSessionId;
      readonly clientRequestId: IdeationRequestId;
    }
  >
>;
export type CloseSessionSignatureIsScopedAndIdempotent = Assert<
  Equal<
    Parameters<IdeationService["closeIdeationSession"]>,
    [actor: IdeationActor, request: IdeationCloseSession]
  >
>;
export type CloseSessionReturnsClosedState = Assert<
  Equal<
    ReturnType<IdeationService["closeIdeationSession"]>,
    Promise<IdeationResult<IdeationClosedSession>>
  >
>;
export type ClosedSessionStatusIsLiteral = Assert<
  Equal<IdeationClosedSession["status"], "closed">
>;
export type SharedRunCodesAreExactlyTheThreeGuards = Assert<
  Equal<
    RunStartErrorCode,
    "INSUFFICIENT_CREDITS" | "ACCOUNT_FROZEN" | "BILLING_DISABLED"
  >
>;
export type InsufficientCreditsIs402 = Assert<
  Equal<RunStartErrorStatus["INSUFFICIENT_CREDITS"], 402>
>;
export type AccountFrozenIs423 = Assert<
  Equal<RunStartErrorStatus["ACCOUNT_FROZEN"], 423>
>;
export type BillingDisabledIs403 = Assert<
  Equal<RunStartErrorStatus["BILLING_DISABLED"], 403>
>;
export type IdeationReusesAllSharedRunCodes = Assert<
  Equal<Extract<IdeationErrorCode, RunStartErrorCode>, RunStartErrorCode>
>;
export type AdditiveContractKeepsEventWireVersion = Assert<
  Equal<IdeationEvent["version"], 1>
>;

export type VerbatimRequestAcceptsOnlyDatabaseSelection = Assert<
  Equal<
    keyof IdeationCreateVerbatimPreview,
    "messageId" | "start" | "end" | "target" | "clientRequestId"
  >
>;
export type VerbatimTargetHasNoArbitraryPath = Assert<
  Absent<Extract<IdeationVerbatimTarget, { kind: "resource_file" }>, "path">
>;
export type CurrentChapterIsServerSelected = Assert<
  Equal<
    Extract<IdeationVerbatimTarget, { kind: "current_chapter" }>,
    { readonly kind: "current_chapter" }
  >
>;
export type VerbatimCannotPretendToBeAModelTask = Assert<
  Equal<IdeationVerbatimPreview["taskId"], null>
>;
export type VerbatimOriginIsExplicitUser = Assert<
  Equal<IdeationVerbatimPreview["origin"], "user_explicit">
>;
export type V12HasSixPreviewKinds = Assert<
  Equal<IdeationPreviewV1_2["kind"], IdeationPreview["kind"] | "verbatim">
>;
export type VerbatimCreationRequiresAuthenticatedActor = Assert<
  Equal<
    Parameters<IdeationServiceV1_2["createVerbatimPreview"]>,
    [actor: IdeationActor, request: IdeationCreateVerbatimPreview]
  >
>;
export type V12PreviewReadsReturnVerbatim = Assert<
  Equal<
    ReturnType<IdeationServiceV1_2["getPreview"]>,
    Promise<IdeationResult<IdeationPreviewV1_2>>
  >
>;
export type V12CoordinatorDeltaAllowsOwnSessionReply = Assert<
  Equal<
    Extract<
      IdeationEventV1_2,
      { type: "delta"; role: "chuangyi-xietiaoyuan" }
    >["text"],
    IdeationCoordinatorReplyText
  >
>;
export type V12DoesNotChangeResetReasons = Assert<
  Equal<
    Extract<IdeationEventV1_2, { type: "reset" }>["reason"],
    Extract<IdeationEvent, { type: "reset" }>["reason"]
  >
>;

/** Compile-time consumer checks only. No service implementation or runtime exports. */
import type {
  IdeationActivateExpression,
  IdeationApprovePreview,
  IdeationCleanHandoff,
  IdeationCompilationRequest,
  IdeationEvent,
  IdeationFilePreview,
  IdeationPreview,
  IdeationService,
} from "../src/index.ts";

type Assert<T extends true> = T;
type Absent<T, K extends PropertyKey> = K extends keyof T ? false : true;
type IsNever<T> = [T] extends [never] ? true : false;

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

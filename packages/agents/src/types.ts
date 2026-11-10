import type {
  AgentMessage,
  AgentTool,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type {
  Api,
  Model,
  Models,
  TranscriptContext,
  Usage,
} from "@earendil-works/pi-ai";
import type { Schema } from "@earendil-works/pi-schema";
import type { ProjectFS, SecurityEvent } from "@ruwen/core";

export type Json =
  | null
  | string
  | number
  | boolean
  | Json[]
  | { [key: string]: Json };
export type Data = { [key: string]: Json };
export const ROLE_IDS = [
  "chuangyi-xietiaoyuan",
  "xiangmu-zhiliyuan",
  "waibu-zhishi-guwen",
  "biaoxian-shejishi",
  "gushi-gousishi",
  "zhangjie-qingjing-bianyiyuan",
  "xiaoshuo-zuozhe",
  "qinggan-duzhe",
  "wenxue-bianji",
  "qingjie-heyanyuan",
  "xianshi-heyanyuan",
  "jiyi-weihuyuan",
] as const;
export type RoleId = (typeof ROLE_IDS)[number];
export type Tier = "strong" | "standard" | "cheap";
export interface RoleSpec {
  id: RoleId;
  promptFiles: readonly {
    path: string;
    section?: "author_core" | "role_row";
  }[];
  buildUserMessage(input: Data): string;
  output:
    | { kind: "text" }
    | { kind: "tool"; toolName: string; schema: Schema<Data> };
  modelTier: Tier;
  maxTurns: number;
}
export interface ModelRuntime {
  mode: "faux" | "real" | "record" | "replay";
  privateStorageRoot?: string;
  models: Models;
  resolve(role: RoleSpec): { model: Model<Api>; thinkingLevel: ThinkingLevel };
  apiKey?(provider: string): string | undefined;
}
export interface SearchProvider {
  search(query: string, signal?: AbortSignal): Promise<Data[]>;
}
/** Metadata only: never include rejected text, provider errors or user wording. */
export type AttemptResetReason =
  | "format_correction"
  | "prompt_overlap_correction"
  | "security_refusal";
export type RoleStreamEvent =
  | { type: "delta"; role: RoleId; text: string }
  | { type: "reset"; role: RoleId; reason: AttemptResetReason };
export interface RoleContext {
  fs: ProjectFS;
  projectKey: string;
  projectId?: string;
  runtime: ModelRuntime;
  upstreamRoot?: string;
  /** Server-only platform store; never a project file or browser callback. */
  onPrompt?: (prompt: { sha256: string; content: string }) => Promise<void>;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxTurns?: number;
  maxTokens?: number;
  onDelta?: (delta: string, role: RoleId) => void;
  onAttemptReset?: (role: RoleId, reason: AttemptResetReason) => void;
  onRequest?: (context: TranscriptContext, role: RoleId) => void;
  onResourceRead?: (resource: Data, role: RoleId) => void;
  search?: SearchProvider;
  searchApproved?: boolean;
}
export interface RoleResult {
  runtimeMode?: ModelRuntime["mode"];
  output: Data | string;
  usage: Usage[];
  costTotal: number;
  promptSha256: string;
  transcript: AgentMessage[];
  model: string;
  durationMs: number;
  readResources: { id: string; path: string; sha256: string }[];
  securityEvents?: SecurityEvent[];
}
export type RoleTool = AgentTool<Schema<Data>, Data>;
export class RoleExecutionError extends Error {
  partial?: RoleResult;
}
export class RoleOutputError extends RoleExecutionError {}
export class RoleSecurityError extends RoleExecutionError {}
export class RoleTruncatedError extends RoleExecutionError {}
export class RoleTurnLimitError extends RoleOutputError {}
export class RoleAbortError extends RoleExecutionError {}
export class RoleTimeoutError extends RoleAbortError {}
export class RoleProviderError extends RoleExecutionError {}

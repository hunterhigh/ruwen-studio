import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  LeakDetector,
  type LeakKind,
  publicTranscript,
  type SecurityEvent,
  type SecurityEventKind,
} from "@ruwen/core";
import { securityLimits } from "../../../../config/security.ts";
import { decodeUserMessage } from "../messages.ts";
import { IncrementalOutput, StreamSuffixError } from "./incremental-output.ts";
import { deploymentCanary } from "./notes.ts";

export const INTERNAL_REFUSAL =
  "这部分属于平台内部设置，我没法提供。我们继续聊你的故事吧。";
export const CONTENT_REFUSAL = "这类内容我不能参与。";
export const SECURITY_ROLE_FAILURE =
  "岗位输出触发平台安全边界，已停止本次岗位。";
// Safe v3 tape metadata reproduces rejected attempts without retaining rejected excerpts.
export const recordedSecurityFailure = (kind: LeakKind) =>
  `recorded_security_boundary:${kind}`;

export class RoleSecurity {
  readonly detector: LeakDetector;
  readonly events: SecurityEvent[] = [];
  failure: LeakKind | undefined;
  streamFailure: string | undefined;
  #stream: IncrementalOutput;
  #scanTail = "";
  #assistant: unknown[] = [];
  #seen = new Set<string>();
  constructor(
    systemPrompt: string,
    user: string,
    structured = false,
    materials: string[] = [],
    publish: (text: string) => void = () => {},
  ) {
    const limits = securityLimits();
    this.detector = new LeakDetector(
      systemPrompt,
      deploymentCanary(),
      [decodeUserMessage(user) ?? user, ...materials],
      structured ? limits.structuredOverlapChars : limits.chatOverlapChars,
    );
    this.#stream = new IncrementalOutput(this.detector, publish);
  }
  record(kind: SecurityEventKind): void {
    if (!this.events.some((event) => event.kind === kind))
      this.events.push({ id: randomUUID(), kind });
  }
  inspect(value: unknown): LeakKind | undefined {
    const kind = this.detector.check(value);
    if (kind) {
      this.failure = kind;
      this.record(kind);
    }
    return kind;
  }
  observe(message: AgentMessage): void {
    if (message.role !== "assistant") return;
    if (message.stopReason === "error")
      for (const kind of ["canary", "prompt_overlap"] as const)
        if (message.errorMessage === recordedSecurityFailure(kind)) {
          this.failure = kind;
          this.record(kind);
        }
    const fingerprint = JSON.stringify([
      message.timestamp,
      message.content,
      message.errorMessage,
    ]);
    if (this.#seen.has(fingerprint)) return;
    this.#seen.add(fingerprint);
    const payloads = message.content.flatMap<unknown>((block) =>
      block.type === "text"
        ? [block.text]
        : block.type === "toolCall"
          ? [block.arguments]
          : [],
    );
    this.#assistant.push(...payloads);
    this.#scanTail = this.detector.tail(this.#assistant);
    this.inspect(this.#assistant);
    if (message.errorMessage) this.inspect(message.errorMessage);
  }
  delta(value: string): void {
    if (this.failure || this.streamFailure) return;
    const joined = this.#scanTail + value;
    const failure = this.detector.check(joined);
    if (failure) {
      this.failure = failure;
      return;
    }
    this.#scanTail = this.detector.tail(joined);
    try {
      const kind = this.#stream.push(value);
      if (kind) {
        this.failure = kind;
      }
    } catch (error) {
      if (!(error instanceof StreamSuffixError)) throw error;
      this.streamFailure = error.message;
    }
  }
  finalizeFailure(): void {
    // A split long canary can provisionally match a shorter prompt window first.
    // Count the final kind once; retain distinct events from actual earlier attempts.
    if (this.failure) this.record(this.failure);
  }
  retry(): void {
    this.failure = undefined;
    this.#assistant = [this.#stream.visibleTail()];
    this.#scanTail = this.detector.tail(this.#assistant);
    this.#seen.clear();
    this.#stream.discard();
  }
  publish(): void {
    this.#stream.finish();
  }
  transcript(messages: unknown): AgentMessage[] {
    return publicTranscript(messages).map((message) => {
      const record = message as Record<string, unknown>;
      if (
        (this.failure && record.role === "assistant") ||
        this.detector.check(record)
      ) {
        return {
          role: record.role,
          content: [{ type: "text", text: INTERNAL_REFUSAL }],
          ...(record.role === "assistant"
            ? {
                usage: record.usage,
                api: record.api,
                provider: record.provider,
                model: record.model,
                stopReason: "error",
              }
            : {}),
          timestamp: record.timestamp,
        };
      }
      return record;
    }) as AgentMessage[];
  }
}

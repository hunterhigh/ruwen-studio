import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  LeakDetector,
  type LeakKind,
  publicTranscript,
  type SecurityEvent,
  type SecurityEventKind,
} from "@ruwen/core";
import { decodeUserMessage } from "../messages.ts";
import type { RoleContext, RoleId } from "../types.ts";
import { deploymentCanary } from "./notes.ts";

export const INTERNAL_REFUSAL =
  "这部分属于平台内部设置，我没法提供。我们继续聊你的故事吧。";
export const CONTENT_REFUSAL = "这类内容我不能参与。";
export const SECURITY_ROLE_FAILURE =
  "岗位输出触发平台安全边界，已停止本次岗位，未自动重试。";

export class RoleSecurity {
  readonly detector: LeakDetector;
  readonly events: SecurityEvent[] = [];
  failure: LeakKind | undefined;
  #deltas: string[] = [];
  #assistant: unknown[] = [];
  #seen = new Set<string>();
  constructor(systemPrompt: string, user: string) {
    this.detector = new LeakDetector(systemPrompt, deploymentCanary(), [
      decodeUserMessage(user) ?? user,
    ]);
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
        : block.type === "thinking"
          ? [block.thinking]
          : block.type === "toolCall"
            ? [block.arguments]
            : [],
    );
    this.#assistant.push(...payloads);
    this.inspect(this.#assistant);
    if (message.errorMessage) this.inspect(message.errorMessage);
  }
  delta(value: string): void {
    this.#deltas.push(value);
  }
  beginAttempt(): void {
    this.#deltas = [];
  }
  publish(ctx: RoleContext, role: RoleId): void {
    for (const delta of this.#deltas) ctx.onDelta?.(delta, role);
    this.#deltas = [];
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

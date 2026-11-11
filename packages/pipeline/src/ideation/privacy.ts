import { deploymentCanary } from "@ruwen/agents";
import { handoff, LeakDetector } from "@ruwen/core";
import { IncrementalOutput } from "../../../agents/src/security/incremental-output.ts";
import { ideationFail } from "./sessions.ts";

/** Raw wording lives only in this private scanner and coordinator DB reads, never a role input/snapshot. */
export function assertNoOriginalWording(
  value: unknown,
  sources: readonly string[],
) {
  // Public technical identifiers are reference tokens, not creative wording. Their ownership,
  // format and hashes are validated separately; free text (including nested content) stays scanned.
  const technical = new Set([
    "id",
    "resource_id",
    "resource_ids",
    "resourceId",
    "projectId",
    "sessionId",
    "taskId",
    "turnId",
    "runId",
    "previewId",
    "sourcePreviewId",
    "supersedesPreviewId",
    "decisionId",
    "sha256",
    "base_sha256",
    "baseSha256",
    "afterSha256",
    "registrySha256",
    "payloadSha256",
    "path",
    "resource_path",
    "createdAt",
    "revision",
    "version",
    "role",
    "recipient",
    "sender",
    "type",
    "kind",
    "status",
    "owner",
    "readers",
    "allowAuthor",
    "supersedes",
  ]);
  const text = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(text)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([key]) => !technical.has(key))
              .map(([key, value]) => [key, text(value)]),
          )
        : v;
  const words = text(value);
  const leaves = (v: unknown): string[] =>
    typeof v === "string"
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(leaves)
        : v && typeof v === "object"
          ? Object.values(v).flatMap(leaves)
          : [];
  const joined = leaves(words).join("");
  for (const source of sources)
    if (
      handoff.sourceOverlapErrors({ value: words as never, joined }, source)
        .length
    )
      ideationFail("OUTPUT_BLOCKED");
}
export class OriginalWordingStream {
  private stream: IncrementalOutput;
  private blocked = false;
  constructor(
    sources: readonly string[],
    privatePublish: (text: string) => void,
  ) {
    // Preserve source-fragment boundaries after published ranges have been excluded.
    this.stream = new IncrementalOutput(
      new OriginalSourceDetector(sources),
      privatePublish,
    );
  }
  push(text: string) {
    if (this.blocked) return false;
    if (this.stream.push(text)) {
      this.blocked = true;
      return false;
    }
    return true;
  }
  reset() {
    this.stream.discard();
    this.blocked = false;
  }
  finish() {
    if (!this.blocked) this.stream.finish();
  }
}

class OriginalSourceDetector extends LeakDetector {
  private readonly fragments: LeakDetector[];
  constructor(sources: readonly string[]) {
    super("", deploymentCanary(), [], 12);
    this.fragments = sources.map(
      (source) => new LeakDetector(source, deploymentCanary(), [], 12),
    );
  }
  override check(value: unknown) {
    return (
      super.check(value) ??
      this.fragments.map((d) => d.check(value)).find(Boolean)
    );
  }
  override pendingLength(text: string) {
    return this.fragments.reduce(
      (length, d) => Math.max(length, d.pendingLength(text)),
      super.pendingLength(text),
    );
  }
}

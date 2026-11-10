import { createHash } from "node:crypto";
import type { ProjectFS } from "../fs/project-fs.ts";

export const LEGACY_PROMPTS = "authoring-ruwen-v5/reports/prompts/";
const resultFields = [
  "runtimeMode",
  "output",
  "usage",
  "costTotal",
  "promptSha256",
  "transcript",
  "model",
  "durationMs",
  "readResources",
  "securityEvents",
] as const;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Strip whole provider thinking blocks, including their signatures, without touching prose. */
export function withoutThinking<T extends { content: unknown }>(message: T): T {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.filter(
          (block) => !object(block) || block.type !== "thinking",
        )
      : message.content,
  };
}

/** System messages and thinking are never part of a user-visible transcript. */
export function publicTranscript(value: unknown): unknown[] {
  return Array.isArray(value)
    ? value
        .filter(
          (message) =>
            object(message) &&
            ["user", "assistant", "toolResult"].includes(String(message.role)),
        )
        .map((message) =>
          Object.hasOwn(message, "content")
            ? withoutThinking(
                message as Record<string, unknown> & { content: unknown },
              )
            : message,
        )
    : [];
}

/** Allowlist the response shape, including when reading old cached results. */
export function publicRoleResult(value: unknown): Record<string, unknown> {
  if (!object(value)) throw new Error("Invalid role result");
  const result = Object.fromEntries(
    resultFields
      .filter((key) => Object.hasOwn(value, key))
      .map((key) => [key, value[key]]),
  );
  result.transcript = publicTranscript(value.transcript);
  return result;
}

export function isRoleArtifact(p: string): boolean {
  return /^authoring-ruwen-v5\/reports\/(?:runs\/[^/]+\/[^/]+|dispatch\/[^/]+)\.json$/.test(
    p,
  );
}

/** Reject legacy private artifacts at archive boundaries until migrated. */
export function assertPublicArtifact(p: string, data: Uint8Array): void {
  if (p.startsWith(LEGACY_PROMPTS))
    throw new Error(
      "Project contains legacy private prompts; migrate before export/import",
    );
  if (isRoleArtifact(p)) {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(data),
    );
    if (
      object(value) &&
      (Object.hasOwn(value, "systemPrompt") ||
        Object.hasOwn(value, "system_prompt") ||
        (Array.isArray(value.transcript) &&
          JSON.stringify(publicTranscript(value.transcript)) !==
            JSON.stringify(value.transcript)))
    )
      throw new Error(
        "Project contains a private role artifact; migrate before export/import",
      );
  }
}

/** Local/offline projects need an explicit platform sink before private files are removed. */
export async function migrateProjectPrompts(
  fs: ProjectFS,
  persist: (sha256: string, content: string) => Promise<void>,
): Promise<{ prompts: number; artifacts: number }> {
  return fs.transaction(async (tx) => {
    const prompts = new Map<string, string>();
    const remove: string[] = [];
    const updates: [string, Record<string, unknown>][] = [];
    const remember = (content: string) => {
      prompts.set(createHash("sha256").update(content).digest("hex"), content);
    };
    for (const p of await tx.list("authoring-ruwen-v5/reports")) {
      if (p.startsWith(LEGACY_PROMPTS)) {
        remember(await tx.readText(p));
        remove.push(p);
      } else if (isRoleArtifact(p)) {
        const value: unknown = JSON.parse(await tx.readText(p));
        if (
          !object(value) ||
          !("promptSha256" in value || "systemPrompt" in value)
        )
          continue;
        if (typeof value.systemPrompt === "string")
          remember(value.systemPrompt);
        if (typeof value.system_prompt === "string")
          remember(value.system_prompt);
        const clean = publicRoleResult(value);
        if (JSON.stringify(clean) !== JSON.stringify(value))
          updates.push([p, clean]);
      }
    }
    // Save first: if the platform sink fails, no project files have changed.
    for (const [hash, content] of prompts) await persist(hash, content);
    for (const [p, value] of updates)
      await tx.write(p, `${JSON.stringify(value, null, 2)}\n`);
    for (const p of remove) await tx.remove(p);
    return { prompts: prompts.size, artifacts: remove.length + updates.length };
  });
}

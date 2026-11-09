import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultUpstreamRoot, rolePromptFiles } from "../prompts/manifest.ts";
import { ROLE_IDS } from "../types.ts";

export interface PromptSourceLock {
  version: 1;
  upstream_commit: string;
  files: Record<string, string>;
}
export const defaultPromptLockPath = fileURLToPath(
  new URL("../../../../config/prompt-sources.lock.json", import.meta.url),
);
export function declaredPromptSources(
  upstreamRoot = defaultUpstreamRoot,
): string[] {
  return [
    ...new Set(
      ROLE_IDS.flatMap((id) =>
        rolePromptFiles(id, upstreamRoot).map((file) => file.path),
      ),
    ),
  ].sort();
}
const comparable = (p: string) =>
  process.platform === "win32"
    ? path.resolve(p).toLowerCase()
    : path.resolve(p);
export async function snapshotPromptSources(
  upstreamRoot = defaultUpstreamRoot,
): Promise<PromptSourceLock> {
  const root = await realpath(upstreamRoot);
  const gitRoot = execFileSync(
    "git",
    ["-C", root, "rev-parse", "--show-toplevel"],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  if (comparable(root) !== comparable(gitRoot))
    throw new Error(
      "Initialize vendor/ruwen as its pinned submodule, without --recursive",
    );
  const upstream_commit = execFileSync(
    "git",
    ["-C", root, "rev-parse", "HEAD"],
    { encoding: "utf8", windowsHide: true },
  ).trim();
  const files: Record<string, string> = {};
  for (const relative of declaredPromptSources(root)) {
    const file = path.join(root, relative);
    const stat = await lstat(file);
    const resolved = path.relative(root, await realpath(file));
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      resolved.startsWith("..") ||
      path.isAbsolute(resolved)
    )
      throw new Error(`Untrusted prompt source path: ${relative}`);
    const bytes = await readFile(file);
    if (bytes.includes(Buffer.from("\r\n")))
      throw new Error(
        `CRLF in assembled upstream file: ${relative}. 检查 core.autocrlf；确认没有本地修改后，从固定 Git 提交重新检出 LF。不要修改差分基线或忽略此检查。`,
      );
    files[relative] = createHash("sha256").update(bytes).digest("hex");
  }
  return { version: 1, upstream_commit, files };
}
export async function verifyPromptSources(
  options: { upstreamRoot?: string; lockPath?: string } = {},
): Promise<PromptSourceLock> {
  const lock = JSON.parse(
    await readFile(options.lockPath ?? defaultPromptLockPath, "utf8"),
  ) as PromptSourceLock;
  if (
    !lock ||
    typeof lock !== "object" ||
    Array.isArray(lock) ||
    lock.version !== 1 ||
    !lock.files ||
    typeof lock.files !== "object" ||
    Array.isArray(lock.files)
  )
    throw new Error("Invalid prompt-sources lock schema");
  const actual = await snapshotPromptSources(options.upstreamRoot);
  if (actual.upstream_commit !== lock.upstream_commit)
    throw new Error(
      "Pinned upstream commit differs from prompt-sources lock; review the upstream diff before updating the lock",
    );
  const paths = Object.keys(actual.files);
  if (paths.join("\n") !== Object.keys(lock.files).sort().join("\n"))
    throw new Error(
      "Assembled prompt source set differs from lock; review added/removed source files",
    );
  for (const relative of paths)
    if (actual.files[relative] !== lock.files[relative])
      throw new Error(
        `Upstream prompt SHA-256 differs from lock: ${relative}. Review the source diff before updating the lock.`,
      );
  return actual;
}

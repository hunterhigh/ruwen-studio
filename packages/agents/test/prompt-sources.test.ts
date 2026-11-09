import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { defaultUpstreamRoot, ROLE_IDS, ROLES } from "../src/index.ts";
import {
  declaredPromptSources,
  type PromptSourceLock,
  snapshotPromptSources,
  verifyPromptSources,
} from "../src/security/prompt-sources.ts";

let root: string, lockPath: string, lock: PromptSourceLock;
const git = (...args: string[]) =>
  execFileSync("git", ["-C", root, "-c", "core.hooksPath=/dev/null", ...args], {
    windowsHide: true,
    stdio: "pipe",
  });
const commit = () => {
  git("add", "--all");
  git(
    "-c",
    "user.name=Security Test",
    "-c",
    "user.email=security@test.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "isolated source fixture",
  );
};
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "ruwen-prompt-lock-"));
  git("init", "--quiet");
  git("config", "core.autocrlf", "false");
  for (const p of declaredPromptSources()) {
    await mkdir(path.dirname(path.join(root, p)), { recursive: true });
    await writeFile(
      path.join(root, p),
      await readFile(path.join(defaultUpstreamRoot, p)),
    );
  }
  commit();
  lockPath = path.join(root, "prompt-lock.json");
  lock = await snapshotPromptSources(root);
  await writeFile(lockPath, JSON.stringify(lock));
});
afterEach(async () => {
  if (!root) return;
  const resolved = path.resolve(root);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith("ruwen-prompt-lock-")
  )
    throw new Error("Unsafe fixture cleanup");
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
});
it("locks exactly the independently collected 12-role source union and verifies production sources", async () => {
  const expected = [
    ...new Set(
      ROLE_IDS.flatMap((id) => ROLES[id].promptFiles.map((file) => file.path)),
    ),
  ].sort();
  expect(Object.keys((await verifyPromptSources()).files)).toEqual(expected);
  expect(Object.keys(lock.files)).toEqual(expected);
  expect(await verifyPromptSources({ upstreamRoot: root, lockPath })).toEqual(
    lock,
  );
});
it("a changed file with an unchanged lock fails its SHA-256 check", async () => {
  const file = path.join(root, Object.keys(lock.files)[0] ?? "missing");
  await writeFile(
    file,
    `${await readFile(file, "utf8")}\nChanged fixture source\n`,
  );
  await expect(
    verifyPromptSources({ upstreamRoot: root, lockPath }),
  ).rejects.toThrow("SHA-256 differs");
});
it("adding a newly admitted reference without a lock update fails", async () => {
  await writeFile(
    path.join(
      root,
      "01-完整插件/ruwen-xiezuo-xitong/skills/ruwen-gushi-gousi/references/new-reference.md",
    ),
    "新参考\n",
  );
  await expect(
    verifyPromptSources({ upstreamRoot: root, lockPath }),
  ).rejects.toThrow("source set differs");
});
it("a missing admitted file fails rather than silently narrowing the source set", async () => {
  await unlink(path.join(root, Object.keys(lock.files)[0] ?? "missing"));
  await expect(
    verifyPromptSources({ upstreamRoot: root, lockPath }),
  ).rejects.toThrow();
});
it("a different upstream commit requires review even when prompt bytes are unchanged", async () => {
  await writeFile(path.join(root, "README.md"), "Non-prompt commit\n");
  commit();
  await expect(
    verifyPromptSources({ upstreamRoot: root, lockPath }),
  ).rejects.toThrow("upstream commit differs");
});
it("CRLF is diagnosed before a hash/parity failure and explicitly names core.autocrlf", async () => {
  const p = Object.keys(lock.files)[0] ?? "missing";
  const file = path.join(root, p);
  await writeFile(
    file,
    (await readFile(file, "utf8")).replaceAll("\n", "\r\n"),
  );
  await expect(
    verifyPromptSources({ upstreamRoot: root, lockPath }),
  ).rejects.toThrow(/CRLF.*core\.autocrlf/);
});
it("an explicitly refreshed lock accepts the reviewed new upstream commit and source bytes", async () => {
  const file = path.join(root, Object.keys(lock.files)[0] ?? "missing");
  await writeFile(
    file,
    `${await readFile(file, "utf8")}\nReviewed fixture change\n`,
  );
  commit();
  const updated = await snapshotPromptSources(root);
  expect(updated.upstream_commit).not.toBe(lock.upstream_commit);
  await writeFile(lockPath, JSON.stringify(updated));
  expect(await verifyPromptSources({ upstreamRoot: root, lockPath })).toEqual(
    updated,
  );
});
it("malformed or extra lock entries cannot bypass the source-set check", async () => {
  await writeFile(lockPath, "null");
  await expect(
    verifyPromptSources({ upstreamRoot: root, lockPath }),
  ).rejects.toThrow("Invalid prompt-sources lock schema");
  lock.files["unadmitted-file.md"] = "0".repeat(64);
  await writeFile(lockPath, JSON.stringify(lock));
  await expect(
    verifyPromptSources({ upstreamRoot: root, lockPath }),
  ).rejects.toThrow("source set differs");
});

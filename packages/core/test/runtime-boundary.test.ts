import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
it("bundled templates, author core and guard patterns match pinned upstream", () => {
  const result = spawnSync(
    process.env.PYTHON_BIN ?? "python",
    ["-I", "-B", "scripts/sync-core-assets.py", "--check"],
    { cwd: root, encoding: "utf8", timeout: 10_000, windowsHide: true },
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
});
it("core starts and initializes projects with no Python executable on PATH", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "ruwen-native-"));
  const project = path.join(parent, "project");
  try {
    await mkdir(project);
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../bin/ruwen-core.ts", import.meta.url)),
        "init-project",
        "--project-root",
        project,
        "--project-id",
        "native-project",
      ],
      {
        cwd: project,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
        env: { ...process.env, PATH: "", PYTHON_BIN: "does-not-exist" },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).project_id).toBe("native-project");
    const scan = async (directory: string): Promise<string[]> => {
      const files: string[] = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const p = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await scan(p)));
        else if (entry.name.endsWith(".ts")) files.push(p);
      }
      return files;
    };
    for (const file of await scan(path.join(root, "packages/core/src")))
      expect(await readFile(file, "utf8"), file).not.toMatch(
        /(?:child_process|execFile|spawnSync|runpy)/,
      );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

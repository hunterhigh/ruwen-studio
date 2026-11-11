import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { previewV41Directory } from "../../src/migration/local-preview.ts";
import { digest } from "../../src/runtime.ts";

const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const fixtures = fileURLToPath(new URL("../fixtures/v4-1/", import.meta.url));
const python = process.env.PYTHON_BIN ?? "python";
const oracle = path.join(
  workspace,
  "vendor/ruwen/01-完整插件/ruwen-xiezuo-xitong/scripts/migrate_v4_1_preview.py",
);
const cli = fileURLToPath(new URL("../../bin/ruwen-core.ts", import.meta.url));
let temporary: string;
beforeAll(async () => {
  temporary = await mkdtemp(path.join(tmpdir(), "ruwen-v41-parity-"));
});
afterAll(async () => {
  if (
    path.dirname(temporary) !== path.resolve(tmpdir()) ||
    !path.basename(temporary).startsWith("ruwen-v41-parity-")
  )
    throw new Error("unsafe cleanup");
  await rm(temporary, { recursive: true, force: true });
});
const env = { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" };
function run(command: string, args: string[]) {
  // -I ignores PYTHONUTF8; use an explicit interpreter flag on Windows pipes.
  if (command === python) args = ["-X", "utf8", ...args];
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
async function snapshot(root: string) {
  const files: Record<string, string> = {};
  const walk = async (relative: string) => {
    for (const entry of await readdir(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(name);
      else files[name] = digest(await readFile(path.join(root, name)));
    }
  };
  await walk("");
  return files;
}

it("matches pinned Python on all 283 files from upstream 东方战国 without changing the sample", async () => {
  const provenance = JSON.parse(
    await readFile(path.join(fixtures, "provenance.json"), "utf8"),
  );
  const archive = path.join(fixtures, provenance.archive);
  expect(digest(await readFile(archive))).toBe(provenance.sha256);
  const sample = path.join(temporary, "sample");
  await mkdir(sample);
  execFileSync(
    python,
    [
      "-I",
      "-B",
      "-c",
      "import sys,tarfile; t=tarfile.open(sys.argv[1]); t.extractall(sys.argv[2],filter='data')",
      archive,
      sample,
    ],
    { env, windowsHide: true },
  );
  const root = path.join(sample, "projects/东方战国");
  const before = await snapshot(root);
  const expected = run(python, ["-I", "-B", oracle, "--project-root", root]);
  expect(await previewV41Directory(root)).toEqual(expected);
  expect(Object.keys(before)).toHaveLength(provenance.files);
  expect(
    run(process.execPath, [
      cli,
      "migrate-v4-1-preview",
      "--project-root",
      root,
    ]),
  ).toEqual(expected);
  expect(await snapshot(root)).toEqual(before);
  expect(await readdir(sample)).toEqual(["projects"]);
}, 30000);

it("matches every prefix, unknowns, ignored paths, raw hashes and explicit external report", async () => {
  const root = path.join(temporary, "rules");
  await mkdir(root);
  for (const relative of [
    "author-voice/pov-lenses/人物.md",
    "author-voice/relationship-lenses/a.md",
    "author-voice/scene-modes/a.md",
    "author-voice/project-core.md",
    "author-voice/project-core.md.bak",
    "characters/a.md",
    "world/a.md",
    "continuity/state.md",
    "outlines/卷一.md",
    "misc/未分类.bin",
    "authoring-v4-1/packets/ignored.md",
    "foo/__pycache__/ignored.bin",
  ]) {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from("原始\r\n\0😀"));
  }
  const before = await snapshot(root);
  const expected = run(python, [
    "-I",
    "-B",
    oracle,
    "--project-root",
    root,
    "--output",
    path.join(temporary, "python-report.json"),
  ]);
  expect(await previewV41Directory(root)).toEqual(expected);
  expect(
    run(process.execPath, [
      cli,
      "migrate-v4-1-preview",
      "--project-root",
      root,
      "--output",
      path.join(temporary, "ts-report.json"),
    ]),
  ).toEqual(expected);
  expect(
    JSON.parse(await readFile(path.join(temporary, "ts-report.json"), "utf8")),
  ).toEqual(expected);
  expect(await snapshot(root)).toEqual(before);
  expect(expected.files).toHaveLength(10);
}, 30000);

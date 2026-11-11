import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { ProjectFS } from "../src/fs/project-fs.ts";
import {
  previewV41Directory,
  writeV41PreviewReport,
} from "../src/migration/local-preview.ts";
import {
  classifyV41Path,
  migrateV41Preview,
} from "../src/migration/v4-1-preview.ts";
import { digest } from "../src/runtime.ts";

let parent: string;
let root: string;
beforeEach(async () => {
  parent = await mkdtemp(path.join(tmpdir(), "ruwen-v41-"));
  root = path.join(parent, "source");
  await mkdir(root);
});
afterEach(async () => {
  if (
    path.dirname(parent) !== path.resolve(tmpdir()) ||
    !path.basename(parent).startsWith("ruwen-v41-")
  )
    throw new Error("unsafe cleanup");
  await rm(parent, { recursive: true, force: true });
});

it("classifies with the exact upstream ordered prefix and suffix semantics", () => {
  expect(classifyV41Path("author-voice\\pov-lenses\\张三.md")).toMatchObject({
    type: "character",
    proposed_path: "人物/POV镜头/张三.md",
  });
  expect(classifyV41Path("continuity/state.md").proposed_path).toBe(
    "世界/当前态势.mdstate.md",
  );
  expect(
    classifyV41Path("author-voice/project-core.md.bak").proposed_path,
  ).toBe("表现/项目声音.md");
  expect(classifyV41Path("misc/资料.md")).toMatchObject({
    type: "governance",
    proposed_path: "治理/待人工归类/资料.md",
  });
});

it("a ProjectFS consumer reads raw bytes and never invokes a mutation", async () => {
  const bytes = Buffer.from("中文\r\n原始字节\0");
  const mutation = async () => {
    throw new Error("Unexpected project mutation");
  };
  const fs: ProjectFS = {
    root: "owned-project",
    path: (value) => value,
    displayPath: (value) => value,
    readText: async () => bytes.toString("utf8"),
    exists: async () => true,
    sha256: async () => digest(bytes),
    write: mutation,
    createExclusive: mutation,
    remove: mutation,
    list: async () => [
      "world/a.md",
      "authoring-v4-1/packets/skip.md",
      "x/__pycache__/skip",
    ],
    read: async () => bytes,
    transaction: async <T>(fn: (tx: ProjectFS) => Promise<T>) => fn(fs),
  };
  const preview = await migrateV41Preview(fs);
  expect(preview.files).toEqual([
    {
      source_path: "world/a.md",
      source_sha256: digest(bytes),
      type: "world",
      proposed_path: "世界/a.md",
      note: "百科材料需归入世界总表或正式系统",
      action: "preview_only",
    },
  ]);
});

it("directory reads leave source files and siblings unchanged, including excluded files", async () => {
  await mkdir(path.join(root, "world"));
  await writeFile(path.join(root, "world/a.md"), "内容\r\n");
  const before = await readdir(parent);
  const result = await previewV41Directory(root);
  expect(result.mode).toBe("read_only_preview");
  expect(result.files[0]?.source_sha256).toBe(digest("内容\r\n"));
  expect(await readdir(parent)).toEqual(before);
  expect(await readFile(path.join(root, "world/a.md"), "utf8")).toBe(
    "内容\r\n",
  );
});

it("explicit output is exclusive and outside the source, with no automatic apply", async () => {
  await writeFile(path.join(root, "old.md"), "旧资料");
  const preview = await previewV41Directory(root);
  await expect(
    writeV41PreviewReport(root, path.join(root, "new/report.json"), preview),
  ).rejects.toThrow("源项目之外");
  expect(await readdir(root)).toEqual(["old.md"]);
  const output = path.join(parent, "report.json");
  await writeV41PreviewReport(root, output, preview);
  expect(JSON.parse(await readFile(output, "utf8"))).toEqual(preview);
  await expect(writeV41PreviewReport(root, output, {})).rejects.toThrow(
    "不会覆盖",
  );
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../bin/ruwen-core.ts", import.meta.url)),
      "migrate_v4_1_preview.py",
      "--project-root",
      root,
      "--apply",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("--apply");
  expect(await readFile(path.join(root, "old.md"), "utf8")).toBe("旧资料");
});

it("an output parent symlink cannot redirect a report into the source", async () => {
  const link = path.join(parent, "link");
  await symlink(root, link, process.platform === "win32" ? "junction" : "dir");
  await expect(
    writeV41PreviewReport(root, path.join(link, "preview.json"), {}),
  ).rejects.toThrow("源项目之外");
  expect(await readdir(root)).toEqual([]);
});

it("source symlinks cannot read another directory", async () => {
  const outside = path.join(parent, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.md"), "其他目录");
  await symlink(
    outside,
    path.join(root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(previewV41Directory(root)).rejects.toThrow("Symbolic links");
});

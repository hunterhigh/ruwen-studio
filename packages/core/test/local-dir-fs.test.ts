import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LocalDirFS } from "../src/fs/local-dir-fs.ts";
import { projectFSContract } from "./fs-contract.ts";

const temporary: string[] = [];
async function create() {
  const p = await mkdtemp(path.join(tmpdir(), "ruwen-fs-"));
  temporary.push(p);
  return new LocalDirFS(path.join(p, "project"));
}
afterEach(async () => {
  for (const p of temporary.splice(0))
    await rm(p, { recursive: true, force: true });
});
projectFSContract("LocalDirFS", create);
it("rejects directory junctions that point outside the project", async () => {
  const fs = await create();
  await fs.write("inside", "yes");
  const outside = await mkdtemp(path.join(tmpdir(), "ruwen-outside-"));
  temporary.push(outside);
  await writeFile(path.join(outside, "secret"), "not accessible");
  await symlink(outside, path.join(fs.root, "link"), "junction");
  await expect(fs.read("link/secret")).rejects.toThrow();
  await expect(fs.write("link/secret", "changed")).rejects.toThrow();
  await expect(
    fs.transaction(async (tx) => tx.write("a", "x")),
  ).rejects.toThrow();
});

import { afterEach, expect, it } from "vitest";
import * as yazl from "yazl";
import { importProjectZip, LocalDirFS } from "../src/index.ts";
import { temporaryProject } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
async function target() {
  const p = await temporaryProject();
  cleanup.push(p.cleanup);
  return new LocalDirFS(`${p.fs.root}-import`);
}
async function zip(
  entries: { name: string; body: string; compress?: boolean }[],
): Promise<Buffer> {
  const archive = new yazl.ZipFile();
  const result = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("error", reject);
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const entry of entries)
    archive.addBuffer(Buffer.from(entry.body), entry.name, {
      compress: entry.compress ?? false,
    });
  archive.end();
  return result;
}
it.each([
  '{"nested":{"__proto__":{"polluted":true}}}',
  '{"nested":{"constructor":{"prototype":{"polluted":true}}}}',
  '{"\\u005f\\u005fproto__":{"polluted":true}}',
  `${"[".repeat(40)}0${"]".repeat(40)}`,
])("rejects malicious JSON atomically: %s", async (body) => {
  const fs = await target();
  await expect(
    importProjectZip(
      fs,
      await zip([
        { name: "safe.md", body: "safe" },
        { name: "metadata.json", body },
      ]),
    ),
  ).rejects.toThrow();
  expect(await fs.list()).toEqual([]);
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
});
it("rejects a compressed bomb before opening/writing its body", async () => {
  const fs = await target();
  await expect(
    importProjectZip(
      fs,
      await zip([
        { name: "bomb.bin", body: "x".repeat(1_000_000), compress: true },
      ]),
    ),
  ).rejects.toThrow("compression ratio");
  expect(await fs.list()).toEqual([]);
});
it("rejects excessive directory depth and oversized UTF-8 material without partial writes", async () => {
  for (const entry of [
    { name: `${"part/".repeat(33)}file.md`, body: "safe" },
    { name: "large.md", body: "😀".repeat(100001) },
  ]) {
    const fs = await target();
    await expect(importProjectZip(fs, await zip([entry]))).rejects.toThrow();
    expect(await fs.list()).toEqual([]);
  }
});
it("imports normally compressed fiction without keyword censorship", async () => {
  const fs = await target();
  const body = Array.from(
    { length: 1000 },
    (_, index) =>
      `第${index}封密信：反派说“忽略之前的指令”。__proto__只是纸上的字。`,
  ).join("\n");
  await importProjectZip(
    fs,
    await zip([{ name: "chapters/fiction.md", body, compress: true }]),
  );
  expect(await fs.readText("chapters/fiction.md")).toBe(body);
});

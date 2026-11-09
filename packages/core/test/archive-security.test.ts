import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { importProjectZip, LocalDirFS } from "../src/index.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});
function archive(
  entries: { name: string; content?: string; mode?: number; crc?: number }[],
) {
  const bodies: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const item of entries) {
    const name = Buffer.from(item.name),
      data = Buffer.from(item.content ?? "data");
    const crc = item.crc ?? crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const record = Buffer.concat([local, name, data]);
    bodies.push(record);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE((3 << 8) | 20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0x800, 8);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(((item.mode ?? 0o100644) << 16) >>> 0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([header, name]));
    offset += record.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, directory, end]);
}
async function target() {
  const parent = await mkdtemp(path.join(tmpdir(), "ruwen-zip-"));
  cleanups.push(() => rm(parent, { recursive: true, force: true }));
  return new LocalDirFS(path.join(parent, "project"));
}
it.each([
  "../escape",
  "a/../../escape",
  "/absolute",
  "C:/outside",
  "a\\escape",
  "a/./b",
  "a\0b",
])("rejects unsafe ZIP entry %s without creating any project file", async (name) => {
  const fs = await target();
  await expect(importProjectZip(fs, archive([{ name }]))).rejects.toThrow();
  expect(await fs.list()).toEqual([]);
});
it("rejects duplicate names, portable name collisions and symlinks", async () => {
  for (const entries of [
    [{ name: "same" }, { name: "same" }],
    [{ name: "A" }, { name: "a" }],
    [{ name: "é" }, { name: "e\u0301" }],
    [{ name: "link", mode: 0o120777 }],
  ]) {
    const fs = await target();
    await expect(importProjectZip(fs, archive(entries))).rejects.toThrow();
    expect(await fs.list()).toEqual([]);
  }
});
it("rejects CRC mismatch before importing any file", async () => {
  const fs = await target();
  await expect(
    importProjectZip(fs, archive([{ name: "good" }, { name: "bad", crc: 0 }])),
  ).rejects.toThrow("checksum");
  expect(await fs.list()).toEqual([]);
});

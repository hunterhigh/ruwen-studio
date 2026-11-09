import type { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import * as yauzl from "yauzl";
import * as yazl from "yazl";
import type { ProjectFS } from "./fs/project-fs.ts";
import { assertPublicArtifact } from "./security/artifacts.ts";

const LIMITS = {
  archiveBytes: 32 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  files: 10000,
};
const logicalPath = (fs: ProjectFS, p: string) => {
  if (
    !p ||
    p.includes("\\") ||
    p.startsWith("/") ||
    /^[a-z]:/i.test(p) ||
    p.split("/").some((part) => part === ".." || part === "." || !part)
  )
    throw new Error("Unsafe archive path");
  const normalized = fs.path(p);
  if (normalized !== p) throw new Error("Noncanonical archive path");
  return p;
};
export async function exportProjectZip(fs: ProjectFS): Promise<Uint8Array> {
  return fs.transaction(async (tx) => {
    const files = await tx.list();
    if (files.length > LIMITS.files) throw new Error("Too many project files");
    const zip = new yazl.ZipFile();
    let total = 0;
    const names = new Set<string>();
    const output = new Promise<Uint8Array>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      zip.outputStream.on("error", reject);
      zip.outputStream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > LIMITS.archiveBytes) {
          (zip.outputStream as Readable).destroy(
            new Error("Archive too large"),
          );
          return;
        }
        chunks.push(chunk);
      });
      zip.outputStream.on("end", () =>
        resolve(new Uint8Array(Buffer.concat(chunks))),
      );
    });
    void output.catch(() => {});
    try {
      for (const p of files) {
        logicalPath(tx, p);
        const folded = p.normalize("NFC").toLowerCase();
        if (names.has(folded))
          throw new Error("Nonportable project path collision");
        names.add(folded);
        const bytes = await tx.read(p);
        assertPublicArtifact(p, bytes);
        total += bytes.length;
        if (bytes.length > LIMITS.fileBytes || total > LIMITS.totalBytes)
          throw new Error("Project exceeds archive limits");
        zip.addBuffer(Buffer.from(bytes), p, {
          mtime: new Date("2026-01-01T00:00:00Z"),
          mode: 0o100644,
        });
      }
      zip.end();
      return await output;
    } catch (error) {
      (zip.outputStream as Readable).destroy(
        error instanceof Error ? error : new Error("Archive export failed"),
      );
      await output.catch(() => {});
      throw error;
    }
  });
}
export async function importProjectZip(
  fs: ProjectFS,
  bytes: Uint8Array,
): Promise<{ files: number; bytes: number }> {
  if (bytes.length > LIMITS.archiveBytes) throw new Error("Archive too large");
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.fromBuffer(
      Buffer.from(bytes),
      {
        lazyEntries: true,
        strictFileNames: true,
        validateEntrySizes: true,
        autoClose: false,
      },
      (error, result) =>
        error || !result
          ? reject(error ?? new Error("Invalid ZIP"))
          : resolve(result),
    ),
  );
  try {
    const files = await new Promise<{ p: string; data: Buffer }[]>(
      (resolve, reject) => {
        const result: { p: string; data: Buffer }[] = [];
        const names = new Set<string>();
        const folded = new Set<string>();
        let total = 0,
          count = 0;
        zip.on("error", reject);
        zip.on("end", () => resolve(result));
        zip.on("entry", (entry: yauzl.Entry) => {
          void (async () => {
            if (++count > LIMITS.files)
              throw new Error("Too many archive entries");
            const name = entry.fileName;
            const directory = name.endsWith("/");
            const p = logicalPath(fs, directory ? name.slice(0, -1) : name);
            if (names.has(p) || folded.has(p.normalize("NFC").toLowerCase()))
              throw new Error("Duplicate or case-colliding archive entry");
            names.add(p);
            folded.add(p.normalize("NFC").toLowerCase());
            const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
            if (
              (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) ||
              entry.isEncrypted()
            )
              throw new Error(
                "Symlink, special or encrypted entries are not allowed",
              );
            if (directory) {
              zip.readEntry();
              return;
            }
            total += entry.uncompressedSize;
            if (
              total > LIMITS.totalBytes ||
              entry.uncompressedSize > LIMITS.fileBytes
            )
              throw new Error("Expanded archive too large");
            const stream = await new Promise<import("node:stream").Readable>(
              (res, rej) =>
                zip.openReadStream(entry, (error, stream) =>
                  error || !stream
                    ? rej(error ?? new Error("Invalid ZIP stream"))
                    : res(stream),
                ),
            );
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of stream) {
              const data = Buffer.from(chunk as Uint8Array);
              size += data.length;
              if (size > entry.uncompressedSize || size > LIMITS.fileBytes) {
                stream.destroy();
                throw new Error("Invalid expanded size");
              }
              chunks.push(data);
            }
            if (size !== entry.uncompressedSize)
              throw new Error("Truncated ZIP entry");
            const data = Buffer.concat(chunks);
            if (crc32(data) !== entry.crc32)
              throw new Error("ZIP checksum mismatch");
            assertPublicArtifact(p, data);
            result.push({ p, data });
            zip.readEntry();
          })().catch(reject);
        });
        zip.readEntry();
      },
    );
    return fs.transaction(async (tx) => {
      if ((await tx.list()).length)
        throw new Error("Import requires an empty project");
      for (const item of files) await tx.createExclusive(item.p, item.data);
      return {
        files: files.length,
        bytes: files.reduce((n, item) => n + item.data.length, 0),
      };
    });
  } finally {
    zip.close();
  }
}

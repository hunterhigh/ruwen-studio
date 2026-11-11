import { createHash } from "node:crypto";
import { AlreadyExists, type ProjectFS } from "@ruwen/core";

/** Core validation can write into this disposable overlay, never into an unapproved project. */
export function previewFS(base: ProjectFS): ProjectFS {
  const changes = new Map<string, Uint8Array | null>();
  const overlay: ProjectFS = {
    root: base.root,
    path: (value) => base.path(value),
    displayPath: (value) => base.displayPath(value),
    read: async (value) => {
      const key = base.path(value);
      if (changes.has(key)) {
        const bytes = changes.get(key);
        if (!bytes) throw new Error("Missing overlay file");
        return bytes;
      }
      return base.read(key);
    },
    readText: async (value) =>
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        await overlay.read(value),
      ),
    write: async (value, data) => {
      changes.set(
        base.path(value),
        typeof data === "string" ? Buffer.from(data) : new Uint8Array(data),
      );
    },
    createExclusive: async (value, data) => {
      if (await overlay.exists(value)) throw new AlreadyExists(value);
      await overlay.write(value, data);
    },
    exists: async (value) => {
      const key = base.path(value);
      return changes.has(key) ? changes.get(key) !== null : base.exists(key);
    },
    list: async (prefix = "") => [
      ...new Set(
        [...(await base.list(prefix)), ...changes.keys()].filter(
          (p) =>
            (!prefix ||
              p === base.path(prefix) ||
              p.startsWith(`${base.path(prefix)}/`)) &&
            changes.get(p) !== null,
        ),
      ),
    ],
    remove: async (value) => {
      changes.set(base.path(value), null);
    },
    sha256: async (value) =>
      createHash("sha256")
        .update(await overlay.read(value))
        .digest("hex"),
    transaction: async (fn) => fn(overlay),
  };
  return overlay;
}

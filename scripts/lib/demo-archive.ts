import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  exportProjectZip,
  LocalDirFS,
  type ProjectFS,
} from "../../packages/core/src/index.ts";

/** Cooperates with LocalDirFS's existing sibling lease, without committing a read transaction. */
export async function demoArchive(
  sourceRoot = fileURLToPath(
    new URL("../../fixtures/demo-project", import.meta.url),
  ),
) {
  const root = path.resolve(sourceRoot),
    lock = `${root}.ruwen-lock`;
  if (
    root === path.parse(root).root ||
    path.dirname(lock) !== path.dirname(root)
  )
    throw new Error("Invalid tool source lock");
  const started = performance.now();
  while (true) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (performance.now() - started > 30000)
        throw new Error("Tool source read lock timeout");
      await delay(10);
    }
  }
  try {
    await writeFile(path.join(lock, "owner"), String(process.pid));
    // The storage argument bypasses nested leases; the outer lease remains held for the whole ZIP.
    const source = new LocalDirFS(root, root);
    const view: ProjectFS = new Proxy(source, {
      get(target, key) {
        if (key === "transaction")
          return <T>(read: (fs: ProjectFS) => Promise<T>) => read(view);
        if (["write", "createExclusive", "remove"].includes(String(key)))
          return async () => {
            throw new Error("Tool source is read-only");
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return await exportProjectZip(view);
  } finally {
    // Only the exact sibling lease acquired above is removed, never source files or transaction trees.
    await rm(lock, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

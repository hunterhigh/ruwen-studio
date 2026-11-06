import { createHash, randomUUID } from "node:crypto";
import * as io from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { AlreadyExists, type ProjectFS, UnsafePath } from "./project-fs.ts";

const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";

/** All cooperating readers/writers lock the project, including during directory swaps. */
export class LocalDirFS implements ProjectFS {
  readonly root: string;
  private readonly storage: string;
  private readonly insideTransaction: boolean;
  private closed = false;
  constructor(root: string, storage?: string) {
    this.root = path.resolve(root);
    this.storage = storage ?? this.root;
    this.insideTransaction = storage !== undefined;
  }
  path(value: string): string {
    if (typeof value !== "string" || value.includes("\0"))
      throw new UnsafePath("Invalid project path");
    const resolved = path.resolve(this.root, value.replaceAll("\\", "/"));
    const relative = path.relative(this.root, resolved).replaceAll("\\", "/");
    if (
      relative === ".." ||
      relative.startsWith("../") ||
      path.isAbsolute(relative) ||
      relative.includes(":")
    ) {
      throw new UnsafePath("Path escapes project root");
    }
    for (const part of relative.split("/").filter(Boolean)) {
      if (
        /[<>:"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      ) {
        throw new UnsafePath("Nonportable or reserved project path");
      }
    }
    return relative;
  }
  displayPath(value: string): string {
    return path.resolve(this.root, this.path(value));
  }
  private async checked(value: string): Promise<string> {
    const relative = this.path(value);
    let current = this.storage;
    for (const part of ["", ...relative.split("/").filter(Boolean)]) {
      if (part) current = path.join(current, part);
      try {
        if ((await io.lstat(current)).isSymbolicLink())
          throw new UnsafePath("Symbolic links are not project resources");
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return path.join(this.storage, relative);
  }
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("Transaction is already closed");
    if (this.insideTransaction) return fn();
    const lock = `${this.root}.ruwen-lock`;
    await io.mkdir(path.dirname(this.root), { recursive: true });
    const started = performance.now();
    while (true) {
      try {
        await io.mkdir(lock);
        await io.writeFile(path.join(lock, "owner"), String(process.pid));
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        if (performance.now() - started > 30_000)
          throw new Error("Project lock timeout");
        await delay(10);
      }
    }
    try {
      return await fn();
    } finally {
      await io.rm(lock, { recursive: true, force: true });
    }
  }
  async read(value: string): Promise<Uint8Array> {
    return this.locked(
      async () => new Uint8Array(await io.readFile(await this.checked(value))),
    );
  }
  async readText(value: string): Promise<string> {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await this.read(value),
    );
  }
  async write(value: string, data: Uint8Array | string): Promise<void> {
    await this.locked(async () => {
      const target = await this.checked(value);
      await io.mkdir(path.dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const file = await io.open(temporary, "wx");
        try {
          await file.writeFile(data);
          await file.sync();
        } finally {
          await file.close();
        }
        await io.rename(temporary, target);
      } finally {
        await io.rm(temporary, { force: true });
      }
    });
  }
  async createExclusive(
    value: string,
    data: Uint8Array | string,
  ): Promise<void> {
    await this.locked(async () => {
      const target = await this.checked(value);
      await io.mkdir(path.dirname(target), { recursive: true });
      let file: io.FileHandle;
      try {
        file = await io.open(target, "wx");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST")
          throw new AlreadyExists(value);
        throw error;
      }
      try {
        await file.writeFile(data);
        await file.sync();
      } catch (error) {
        await io.rm(target, { force: true });
        throw error;
      } finally {
        await file.close();
      }
    });
  }
  async exists(value: string): Promise<boolean> {
    return this.locked(async () => {
      try {
        return (await io.stat(await this.checked(value))).isFile();
      } catch (error) {
        if (missing(error)) return false;
        throw error;
      }
    });
  }
  async list(prefix = ""): Promise<string[]> {
    return this.locked(async () => {
      const relative = this.path(prefix);
      const start = await this.checked(relative);
      const found: string[] = [];
      const walk = async (current: string) => {
        let stat: Awaited<ReturnType<typeof io.lstat>>;
        try {
          stat = await io.lstat(current);
        } catch (error) {
          if (missing(error)) return;
          throw error;
        }
        if (stat.isSymbolicLink())
          throw new UnsafePath("Symbolic links are not project resources");
        if (stat.isFile())
          found.push(
            path.relative(this.storage, current).replaceAll("\\", "/"),
          );
        else if (stat.isDirectory())
          for (const name of await io.readdir(current))
            await walk(path.join(current, name));
      };
      await walk(start);
      return found.sort((a, b) => {
        const left = Array.from(a, (c) => c.codePointAt(0) ?? 0);
        const right = Array.from(b, (c) => c.codePointAt(0) ?? 0);
        for (let i = 0; i < Math.min(left.length, right.length); i++)
          if (left[i] !== right[i]) return (left[i] ?? 0) - (right[i] ?? 0);
        return left.length - right.length;
      });
    });
  }
  async remove(value: string): Promise<void> {
    await this.locked(async () => {
      await io.unlink(await this.checked(value)).catch((error) => {
        if (!missing(error)) throw error;
      });
    });
  }
  async sha256(value: string): Promise<string> {
    return createHash("sha256")
      .update(await this.read(value))
      .digest("hex");
  }
  async transaction<T>(fn: (tx: ProjectFS) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("Transaction is already closed");
    const run = async () => {
      // Only validated sibling paths created here are recursively removed.
      const stage = path.join(
        path.dirname(this.storage),
        `.ruwen-tx-${randomUUID()}`,
      );
      const backup = `${stage}.backup`;
      if (
        path.dirname(stage) !== path.dirname(this.storage) ||
        path.dirname(backup) !== path.dirname(this.storage)
      )
        throw new UnsafePath("Invalid transaction cleanup target");
      let hadRoot = false;
      let swapped = false;
      let tx: LocalDirFS | undefined;
      try {
        await this.checked("");
        const files = await new LocalDirFS(this.root, this.storage).list();
        await io.mkdir(stage);
        tx = new LocalDirFS(this.root, stage);
        for (const file of files) {
          const destination = path.join(stage, file);
          await io.mkdir(path.dirname(destination), { recursive: true });
          await io.copyFile(path.join(this.storage, file), destination);
        }
        const result = await fn(tx);
        if (!this.insideTransaction) {
          const after = await tx.list();
          await io.mkdir(backup);
          for (const file of files) {
            const target = path.join(backup, file);
            await io.mkdir(path.dirname(target), { recursive: true });
            await io.copyFile(await this.checked(file), target);
          }
          const removeFile = async (file: string) => {
            const absolute = await this.checked(file);
            await io.unlink(absolute).catch((error) => {
              if (!missing(error)) throw error;
            });
            let parent = path.dirname(absolute);
            while (parent !== this.storage) {
              try {
                await io.rmdir(parent);
              } catch {
                break;
              }
              parent = path.dirname(parent);
            }
          };
          try {
            await io.mkdir(this.storage, { recursive: true });
            for (const file of files)
              if (!after.includes(file)) await removeFile(file);
            for (const file of after) {
              const target = await this.checked(file);
              await io.mkdir(path.dirname(target), { recursive: true });
              await io.rename(path.join(stage, file), target);
            }
          } catch (error) {
            // All ProjectFS users remain locked until the exact previous tree is restored.
            for (const file of after) await removeFile(file);
            for (const file of files) {
              const target = await this.checked(file);
              await io.mkdir(path.dirname(target), { recursive: true });
              await io.copyFile(path.join(backup, file), target);
            }
            await io.rm(backup, { recursive: true, force: true });
            throw error;
          }
          hadRoot = true;
          swapped = true;
        } else {
          try {
            await io.rename(this.storage, backup);
            hadRoot = true;
          } catch (error) {
            if (!missing(error)) throw error;
          }
          try {
            await io.rename(stage, this.storage);
            swapped = true;
          } catch (error) {
            if (hadRoot) await io.rename(backup, this.storage);
            throw error;
          }
        }
        return result;
      } finally {
        if (tx) tx.closed = true;
        await io
          .rm(stage, { recursive: true, force: true })
          .catch(() => undefined);
        // Cleanup after the commit point cannot turn a successful commit into an apparent rollback.
        if (swapped && hadRoot)
          await io
            .rm(backup, { recursive: true, force: true })
            .catch(() => undefined);
      }
    };
    return this.insideTransaction ? run() : this.locked(run);
  }
}

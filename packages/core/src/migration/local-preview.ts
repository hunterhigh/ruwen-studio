import * as io from "node:fs/promises";
import path from "node:path";
import { LocalDirFS } from "../fs/local-dir-fs.ts";
import { type ProjectFS, UnsafePath } from "../fs/project-fs.ts";
import { CoreError, digest, pyJson } from "../runtime.ts";
import { migrateV41Preview } from "./v4-1-preview.ts";

const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
// pathlib.resolve(strict=False), also resolving an existing symlink parent.
async function resolved(value: string): Promise<string> {
  const absolute = path.resolve(value);
  try {
    return await io.realpath(absolute);
  } catch (error) {
    if (!missing(error)) throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(await resolved(parent), path.basename(absolute));
  }
}

/** Unlike LocalDirFS this adapter creates neither lock directories nor transaction copies. */
class ReadOnlySource implements ProjectFS {
  readonly root: string;
  private readonly paths: LocalDirFS;
  constructor(root: string) {
    this.root = root;
    this.paths = new LocalDirFS(root);
  }
  path(value: string) {
    return this.paths.path(value);
  }
  displayPath(value: string) {
    return this.paths.displayPath(value);
  }
  private async checked(value: string) {
    const relative = this.path(value);
    let current = this.root;
    for (const part of ["", ...relative.split("/").filter(Boolean)]) {
      if (part) current = path.join(current, part);
      try {
        if ((await io.lstat(current)).isSymbolicLink())
          throw new UnsafePath("Symbolic links are not project resources");
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return current;
  }
  async read(value: string) {
    return new Uint8Array(await io.readFile(await this.checked(value)));
  }
  async readText(value: string) {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await this.read(value),
    );
  }
  async exists(value: string) {
    try {
      await io.stat(await this.checked(value));
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
  async list(prefix = "") {
    const files: string[] = [];
    const walk = async (relative: string): Promise<void> => {
      const absolute = await this.checked(relative);
      let stat: Awaited<ReturnType<typeof io.lstat>>;
      try {
        stat = await io.lstat(absolute);
      } catch (error) {
        if (missing(error)) return;
        throw error;
      }
      if (stat.isFile()) files.push(this.path(relative));
      else if (stat.isDirectory())
        for (const name of await io.readdir(absolute))
          await walk(path.posix.join(relative, name));
      else throw new UnsafePath("Unsupported project file type");
    };
    await walk(this.path(prefix));
    return files;
  }
  async sha256(value: string) {
    return digest(await this.read(value));
  }
  async write(): Promise<never> {
    throw new CoreError("迁移预览只读，不会写入源项目");
  }
  async createExclusive(): Promise<never> {
    throw new CoreError("迁移预览只读，不会写入源项目");
  }
  async remove(): Promise<never> {
    throw new CoreError("迁移预览只读，不会写入源项目");
  }
  async transaction<T>(fn: (tx: ProjectFS) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

export async function previewV41Directory(root: string) {
  return migrateV41Preview(new ReadOnlySource(await resolved(root)));
}
function outside(root: string, output: string) {
  const relative = path.relative(root, output);
  if (
    !relative ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw new CoreError("迁移预览输出必须位于源项目之外");
}
/** Only an explicitly requested external report is written; no apply operation exists. */
export async function writeV41PreviewReport(
  root: string,
  output: string,
  result: unknown,
) {
  const source = await resolved(root);
  const target = await resolved(output);
  outside(source, target);
  try {
    await io.lstat(target);
    throw new CoreError("迁移预览不会覆盖已有文件");
  } catch (error) {
    if (!missing(error)) throw error;
  }
  await io.mkdir(path.dirname(target), { recursive: true });
  outside(source, await resolved(target));
  try {
    await io.writeFile(target, `${pyJson(result)}\n`, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new CoreError("迁移预览不会覆盖已有文件");
    throw error;
  }
}

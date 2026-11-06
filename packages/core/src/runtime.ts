import { createHash } from "node:crypto";
import { comparePaths } from "./fs/order.ts";
import type { ProjectFS } from "./fs/project-fs.ts";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export type ObjectData = { [key: string]: Json };
export class CoreError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}
export const object = (v: unknown): v is ObjectData =>
  typeof v === "object" && v !== null && !Array.isArray(v);
export const text = (v: unknown): v is string => typeof v === "string";
export const chars = (s: string) => Array.from(s).length;
export const tail = (s: string, n: number) => Array.from(s).slice(-n).join("");
export const readText = async (fs: ProjectFS, path: string) =>
  (await fs.readText(path)).replace(/\r\n?/g, "\n");
export const digest = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
export const keysEqual = (v: ObjectData, keys: readonly string[]) =>
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
export const utcNow = () =>
  new Date()
    .toISOString()
    .replace(/\.000Z$/, "+00:00")
    .replace(/\.(\d{3})Z$/, ".$1000+00:00");
export const timestampToken = () =>
  new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.(\d{3})Z$/, "$1000Z");
export function pyJson(value: unknown, pretty = true): string {
  if (pretty) return JSON.stringify(value, null, 2);
  if (Array.isArray(value))
    return `[${value.map((v) => pyJson(v, false)).join(", ")}]`;
  if (object(value))
    return `{${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(k)}: ${pyJson(v, false)}`)
      .join(", ")}}`;
  return JSON.stringify(value);
}
export async function readJson(
  fs: ProjectFS,
  path: string,
): Promise<ObjectData> {
  const v: unknown = JSON.parse(await fs.readText(path));
  if (!object(v))
    throw new CoreError(`Expected a JSON object: ${fs.displayPath(path)}`);
  return v;
}
export const encodedText = (value: string, lf = false) =>
  process.platform === "win32" && !lf ? value.replaceAll("\n", "\r\n") : value;
export const writeText = (
  fs: ProjectFS,
  path: string,
  value: string,
  lf = false,
) => fs.write(path, encodedText(value, lf));
export const writeJson = (
  fs: ProjectFS,
  path: string,
  value: unknown,
  lf = false,
) => writeText(fs, path, `${pyJson(value)}\n`, lf);
export const ref = async (fs: ProjectFS, path: string) => ({
  path: fs.path(path),
  sha256: await fs.sha256(path),
});
export async function requireFile(
  fs: ProjectFS,
  value: unknown,
): Promise<string> {
  if (!text(value) || !value.trim())
    throw new CoreError("资源路径必须是非空文本");
  const p = fs.path(value);
  if (!(await fs.exists(p))) throw new CoreError(`资源文件不存在：${p}`);
  return p;
}
export function under(path: string, prefix: string, message: string): void {
  if (!path.startsWith(`${prefix}/`)) throw new CoreError(message);
}
export async function directoryHash(
  fs: ProjectFS,
  prefix: string,
): Promise<string> {
  const parts: string[] = [];
  for (const file of (await fs.list(prefix)).sort(comparePaths))
    parts.push(`${file.slice(prefix.length + 1)}\0${await fs.sha256(file)}\n`);
  return digest(parts.join(""));
}

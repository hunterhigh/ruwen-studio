import type { ProjectFS } from "../fs/project-fs.ts";
import {
  CoreError,
  chars,
  encodedText,
  keysEqual,
  type ObjectData,
  object,
  pyJson,
  readText,
  text,
  utcNow,
} from "../runtime.ts";

export const AUDIT_KEYS = [
  "role",
  "resource_ids",
  "change",
  "scope",
  "conflict_category",
  "approval_status",
  "result",
];
const SCOPE = ["project", "volume", "arc", "chapter"];
export function validateAudit(value: unknown): string[] {
  if (!object(value) || !keysEqual(value, AUDIT_KEYS))
    return ["审计事件字段必须与白名单完全一致"];
  const errors: string[] = [];
  if (!text(value.role) || !/^[a-z][a-z0-9-]{2,63}$/.test(value.role))
    errors.push("role无效");
  if (
    !Array.isArray(value.resource_ids) ||
    !value.resource_ids.every((v) => text(v) && /^[a-z0-9-]{2,64}$/.test(v))
  )
    errors.push("resource_ids无效");
  for (const key of ["change", "result"])
    if (!text(value[key]) || !/^[a-z0-9_-]{2,80}$/.test(value[key]))
      errors.push(`${key}必须是技术事件标识`);
  if (
    !object(value.scope) ||
    !keysEqual(value.scope, SCOPE) ||
    Object.values(value.scope).some((v) => v !== null && !text(v))
  )
    errors.push("scope必须使用固定标量字段");
  if (
    value.conflict_category != null &&
    (!text(value.conflict_category) ||
      !/^[a-z0-9_-]{2,80}$/.test(value.conflict_category))
  )
    errors.push("conflict_category无效");
  if (
    !text(value.approval_status) ||
    !["not_required", "pending", "approved", "rejected"].includes(
      value.approval_status,
    )
  )
    errors.push("approval_status无效");
  return errors;
}
export async function readEntries(
  fs: ProjectFS,
  path: string,
): Promise<ObjectData[]> {
  if (!(await fs.exists(path))) return [];
  const result: ObjectData[] = [];
  for (const [i, line] of (await readText(fs, path)).split("\n").entries())
    if (line.trim()) {
      const entry: unknown = JSON.parse(line);
      if (!object(entry)) throw new CoreError(`第${i + 1}行不是对象`, 1);
      result.push(entry);
    }
  return result;
}
async function appendLine(
  fs: ProjectFS,
  path: string,
  value: ObjectData,
): Promise<void> {
  const before = (await fs.exists(path))
    ? await fs.read(path)
    : new Uint8Array();
  const after = new TextEncoder().encode(
    encodedText(`${pyJson(value, false)}\n`),
  );
  const bytes = new Uint8Array(before.length + after.length);
  bytes.set(before);
  bytes.set(after, before.length);
  await fs.write(path, bytes);
}
export async function appendAudit(
  fs: ProjectFS,
  value: unknown,
): Promise<ObjectData> {
  const errors = validateAudit(value);
  if (errors.length || !object(value))
    throw new CoreError(errors.join("；"), 1);
  return fs.transaction(async (tx) => {
    const event = { time: utcNow(), ...value };
    await appendLine(tx, "治理/审计账本.jsonl", event);
    return event;
  });
}
export const PROBLEM_KEYS = [
  "location",
  "category",
  "condition",
  "handling",
  "result",
  "task_id",
  "status",
];
export async function appendProblem(
  fs: ProjectFS,
  value: unknown,
): Promise<ObjectData> {
  if (!object(value) || !keysEqual(value, PROBLEM_KEYS))
    throw new CoreError("问题条目字段必须与白名单完全一致", 1);
  if (
    !PROBLEM_KEYS.every(
      (k) => text(value[k]) && chars(value[k]) > 0 && chars(value[k]) <= 1000,
    )
  )
    throw new CoreError("问题条目字段必须是有长度限制的文本", 1);
  return fs.transaction(async (tx) => {
    const now = utcNow();
    const path = "治理/文学问题账本.jsonl";
    const same = (await readEntries(tx, path)).filter(
      (x) => x.category === value.category,
    );
    const tasks = new Set([...same.map((x) => x.task_id), value.task_id]);
    const entry = {
      ...value,
      first_seen: same.length
        ? (same[0]?.first_seen ?? same[0]?.recorded_at ?? null)
        : now,
      last_seen: now,
      recorded_at: now,
      recurrence_count: same.length + 1,
      recurrence_candidate: same.length + 1 >= 3 && tasks.size >= 2,
    };
    await appendLine(tx, path, entry);
    return entry;
  });
}
export async function problemSummary(fs: ProjectFS): Promise<ObjectData> {
  const entries = await readEntries(fs, "治理/文学问题账本.jsonl");
  const categories = new Map<string, { count: number; tasks: Set<string> }>();
  for (const entry of entries) {
    const key = String(entry.category);
    const stat = categories.get(key) ?? { count: 0, tasks: new Set<string>() };
    stat.count++;
    stat.tasks.add(String(entry.task_id));
    categories.set(key, stat);
  }
  return {
    total: entries.length,
    categories: [...categories]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([category, value]) => ({
        category,
        count: value.count,
        task_count: value.tasks.size,
        recurrence_candidate: value.count >= 3 && value.tasks.size >= 2,
      })),
  };
}

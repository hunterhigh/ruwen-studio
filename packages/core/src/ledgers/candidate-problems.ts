import type { ProjectFS } from "../fs/project-fs.ts";
import {
  CoreError,
  chars,
  digest,
  encodedText,
  keysEqual,
  type ObjectData,
  object,
  pyJson,
  utcNow,
} from "../runtime.ts";
import { readEntries } from "./index.ts";

export const PATH = "治理/文学问题账本.jsonl";
export const RUN_DIRECTORY = "authoring-ruwen-v5/reports/runs";
export type CandidateStatus = "pending" | "approved" | "abandoned" | "returned";
export interface Candidate {
  projectId: string;
  chapter: string;
  runId: string;
  status: CandidateStatus;
}
const fields = ["location", "category", "condition", "handling", "result"];
const statuses: CandidateStatus[] = [
  "pending",
  "approved",
  "abandoned",
  "returned",
];
export function chapterId(value: string): string {
  if (!value.trim() || chars(value) > 100)
    throw new CoreError("文学问题章节号无效");
  return /^\d+$/.test(value)
    ? BigInt(value).toString().padStart(3, "0")
    : value;
}
export const taskId = (projectId: string, chapter: string) =>
  JSON.stringify([projectId, chapterId(chapter)]);
export function statusFromRun(run: ObjectData): CandidateStatus {
  if (
    [
      "CANDIDATE_APPROVED",
      "MEMORY_PREVIEW_READY",
      "AWAITING_MEMORY_APPROVAL",
      "MEMORY_COMMITTED",
      "DONE",
    ].includes(String(run.status)) ||
    (Array.isArray(run.events) &&
      run.events.some(
        (event) => object(event) && event.status === "CANDIDATE_APPROVED",
      ))
  )
    return "approved";
  return run.status === "CANCELLED"
    ? "abandoned"
    : run.status === "RETURNED"
      ? "returned"
      : "pending";
}
/** Derive old B1 run-UUID tasks from saved provenance; never guess an unknown chapter. */
async function load(fs: ProjectFS, projectId: string) {
  const entries = await readEntries(fs, PATH);
  const indices = new Map<string, number>();
  let migrated = false;
  for (const entry of entries) {
    if (typeof entry.run_id === "string") continue;
    const legacyId = String(entry.task_id);
    if (!/^[a-f0-9-]{36}$/.test(legacyId)) continue;
    const p = `${RUN_DIRECTORY}/${legacyId}/run.json`;
    if (!(await fs.exists(p))) continue;
    const run: unknown = JSON.parse(await fs.readText(p));
    if (!object(run) || run.id !== legacyId || typeof run.chapter !== "string")
      continue;
    const index = indices.get(legacyId) ?? 0;
    indices.set(legacyId, index + 1);
    Object.assign(entry, {
      id: digest(`${legacyId}\0${index}`),
      run_id: legacyId,
      project_id: projectId,
      chapter: chapterId(run.chapter),
      task_id: taskId(projectId, run.chapter),
      status: statusFromRun(run),
    });
    migrated = true;
  }
  return { entries, migrated };
}
function summary(entries: ObjectData[]) {
  const categories = new Map<string, { count: number; tasks: Set<string> }>();
  for (const entry of entries) {
    const category = String(entry.category);
    const item = categories.get(category) ?? {
      count: 0,
      tasks: new Set<string>(),
    };
    item.count++;
    // Unresolvable legacy rows still count as observations, not invented distinct tasks.
    if (
      typeof entry.project_id === "string" &&
      typeof entry.chapter === "string"
    )
      item.tasks.add(taskId(entry.project_id, entry.chapter));
    categories.set(category, item);
  }
  return {
    total: entries.length,
    categories: [...categories]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([category, item]) => ({
        category,
        count: item.count,
        task_count: item.tasks.size,
        recurrence_candidate: item.count >= 3 && item.tasks.size >= 2,
      })),
  };
}
async function save(fs: ProjectFS, entries: ObjectData[]) {
  // Recompute historical flags after task migration; changing status never removes an observation.
  const stats = new Map<string, { count: number; tasks: Set<string> }>();
  for (const entry of entries) {
    const category = String(entry.category);
    const stat = stats.get(category) ?? { count: 0, tasks: new Set<string>() };
    stat.count++;
    if (
      typeof entry.project_id === "string" &&
      typeof entry.chapter === "string"
    )
      stat.tasks.add(taskId(entry.project_id, entry.chapter));
    stats.set(category, stat);
    entry.recurrence_count = stat.count;
    entry.recurrence_candidate = stat.count >= 3 && stat.tasks.size >= 2;
  }
  await fs.write(
    PATH,
    encodedText(`${entries.map((entry) => pyJson(entry, false)).join("\n")}\n`),
  );
}
/** Idempotent by successful editor run + problem ordinal, not by chapter. */
export async function record(
  fs: ProjectFS,
  candidate: Candidate,
  problems: unknown,
): Promise<void> {
  if (
    !candidate.projectId.trim() ||
    chars(candidate.projectId) > 200 ||
    !candidate.runId.trim() ||
    chars(candidate.runId) > 100 ||
    !statuses.includes(candidate.status)
  )
    throw new CoreError("文学问题候选身份或状态无效");
  const chapter = chapterId(candidate.chapter);
  if (!Array.isArray(problems) || problems.length > 64)
    throw new CoreError("文学问题列表无效");
  for (const problem of problems)
    if (
      !object(problem) ||
      !keysEqual(problem, fields) ||
      !fields.every(
        (key) =>
          typeof problem[key] === "string" &&
          String(problem[key]).trim() &&
          chars(String(problem[key])) <= 1000,
      )
    )
      throw new CoreError("文学问题字段无效");
  if (!problems.length) return;
  await fs.transaction(async (tx) => {
    const { entries, migrated } = await load(tx, candidate.projectId);
    let changed = migrated;
    for (const [index, problem] of problems.entries()) {
      const id = digest(`${candidate.runId}\0${index}`);
      const existing = entries.find((entry) => entry.id === id);
      if (existing) {
        if (
          existing.project_id !== candidate.projectId ||
          existing.chapter !== chapter ||
          !fields.every((key) => existing[key] === problem[key])
        )
          throw new CoreError("同一编辑提交的问题记录已变化");
        continue; // A replay must not reset approved/abandoned/returned to pending.
      }
      const now = utcNow();
      const same = entries.find((entry) => entry.category === problem.category);
      entries.push({
        ...problem,
        id,
        run_id: candidate.runId,
        project_id: candidate.projectId,
        chapter,
        task_id: taskId(candidate.projectId, chapter),
        status: candidate.status,
        first_seen: same?.first_seen ?? same?.recorded_at ?? now,
        last_seen: now,
        recorded_at: now,
      });
      changed = true;
    }
    if (changed) await save(tx, entries);
  });
}
export async function setStatus(
  fs: ProjectFS,
  runId: string,
  status: CandidateStatus,
  projectId: string,
): Promise<void> {
  if (!statuses.includes(status)) throw new CoreError("候选状态无效");
  if (!(await fs.exists(PATH))) return;
  await fs.transaction(async (tx) => {
    const { entries, migrated } = await load(tx, projectId);
    let changed = migrated;
    for (const entry of entries)
      if (
        entry.run_id === runId &&
        entry.project_id === projectId &&
        entry.status !== status
      ) {
        if (entry.status === "approved" && status !== "approved") continue;
        entry.status = status;
        entry.status_updated_at = utcNow();
        changed = true;
      }
    if (changed) await save(tx, entries);
  });
}
/** Same I10 output whitelist as the original core ledger; no private fields. */
export async function counts(
  fs: ProjectFS,
  projectId: string,
): Promise<ObjectData> {
  return summary((await load(fs, projectId)).entries);
}

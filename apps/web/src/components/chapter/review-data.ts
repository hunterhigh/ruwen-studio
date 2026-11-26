import type { RunStatus } from "@ruwen/pipeline";
import type { runDetail } from "../../server/api.ts";

export type Detail = Awaited<ReturnType<typeof runDetail>>;
export const roles = [
  "xiaoshuo-zuozhe",
  "qinggan-duzhe",
  "wenxue-bianji",
  "qingjie-heyanyuan",
  "xianshi-heyanyuan",
  "jiyi-weihuyuan",
] as const;
export type ChapterRole = (typeof roles)[number];
export const stopped = new Set<RunStatus>([
  "DONE",
  "RETURNED",
  "CANCELLED",
  "FAILED",
  "FAILED_PRECONDITION",
]);
export const roleOnDeck: Partial<Record<RunStatus, ChapterRole>> = {
  PACKET_COMPILED: "xiaoshuo-zuozhe",
  AUTHOR_DONE: "qinggan-duzhe",
  READER_DONE: "wenxue-bianji",
  EDITOR_DONE: "qingjie-heyanyuan",
  PLOT_CHECKED: "xianshi-heyanyuan",
  CANDIDATE_APPROVED: "jiyi-weihuyuan",
};

const completedByStatus: Record<RunStatus, number> = {
  REQUESTED: 0,
  READINESS_OK: 0,
  PACKET_COMPILED: 0,
  AUTHOR_DONE: 1,
  READER_DONE: 2,
  EDITOR_DONE: 3,
  PLOT_CHECKED: 4,
  REALITY_CHECKED: 5,
  AWAITING_CANDIDATE_APPROVAL: 5,
  CANDIDATE_APPROVED: 5,
  MEMORY_PREVIEW_READY: 6,
  AWAITING_MEMORY_APPROVAL: 6,
  MEMORY_COMMITTED: 6,
  DONE: 6,
  RETURNED: 0,
  FAILED_PRECONDITION: 0,
  FAILED: 0,
  CANCELLED: 0,
};

export function completedRoleCount(
  status: RunStatus,
  events: ReadonlyArray<{ status: RunStatus }> = [],
) {
  const count = completedByStatus[status] ?? 0;
  if (status !== "RETURNED" && status !== "FAILED" && status !== "CANCELLED")
    return count;
  return events.reduce(
    (known, event) => Math.max(known, completedByStatus[event.status] ?? 0),
    count,
  );
}

export type ChangeKind = "fact" | "literary";
type Indexed<T> = T & { sourceIndex: number };
export interface Edit {
  original: string;
  replacement: string;
  kind: ChangeKind;
  reason: string;
}
export interface Reaction {
  anchor: string;
  type: string;
  note: string;
}
export interface Issue {
  promise?: string;
  problem?: string;
  evidence?: string;
  category?: string;
  rule_ref?: string;
}
export interface Change {
  before: string;
  after: string;
  kind: ChangeKind;
  reason: string;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function editsFrom(value: unknown): Indexed<Edit>[] {
  const { edits } = object(value);
  return Array.isArray(edits)
    ? edits.flatMap((item, sourceIndex) => {
        const { original, replacement, reason, kind } = object(item);
        return typeof original === "string" &&
          original.length > 0 &&
          typeof replacement === "string" &&
          typeof reason === "string" &&
          (kind === "fact" || kind === "literary")
          ? [{ original, replacement, reason, kind, sourceIndex }]
          : [];
      })
    : [];
}

export function parseChanges(value: string | undefined): Change[] {
  try {
    const rows: unknown = JSON.parse(value || "[]");
    return Array.isArray(rows)
      ? rows.filter((item): item is Change => {
          const change = object(item);
          return (
            typeof change.before === "string" &&
            typeof change.after === "string" &&
            typeof change.reason === "string" &&
            (change.kind === "fact" || change.kind === "literary")
          );
        })
      : [];
  } catch {
    return [];
  }
}

export function readingFrom(value: unknown): Indexed<Reaction>[] {
  const { reactions } = object(value);
  return Array.isArray(reactions)
    ? reactions.flatMap((item, sourceIndex) => {
        const { anchor, type, note } = object(item);
        return typeof anchor === "string" &&
          typeof type === "string" &&
          typeof note === "string"
          ? [{ anchor, type, note, sourceIndex }]
          : [];
      })
    : [];
}

export function verdictFrom(value: unknown) {
  const { pass, issues } = object(value);
  if (typeof pass !== "boolean") return undefined;
  return {
    pass,
    issues: Array.isArray(issues)
      ? issues.flatMap((item, sourceIndex): Indexed<Issue>[] => {
          const { promise, problem, evidence, category, rule_ref } =
            object(item);
          if (
            ![promise, problem, evidence, category, rule_ref].some(
              (entry) => typeof entry === "string",
            )
          )
            return [];
          return [
            {
              sourceIndex,
              ...(typeof promise === "string" && { promise }),
              ...(typeof problem === "string" && { problem }),
              ...(typeof evidence === "string" && { evidence }),
              ...(typeof category === "string" && { category }),
              ...(typeof rule_ref === "string" && { rule_ref }),
            },
          ];
        })
      : [],
  };
}

export function timeOf(run: Detail["run"] | undefined, status: RunStatus) {
  const time = run?.events?.findLast((event) => event.status === status)?.time;
  return time && Number.isFinite(Date.parse(time)) ? time : undefined;
}

export function chapterTitle(prose: string) {
  const match =
    /^\s*(?:#{1,3}\s+)?第\s*[0-9〇零一二三四五六七八九十百千万两]+\s*章[ \t　·：:]+([^\r\n]+)/u.exec(
      prose,
    );
  return match?.[1]?.trim() ?? "";
}

export interface Usage {
  run_id: string;
  role_id: string;
  charged_credits: string | null;
}
export function roleCredits(
  usage: readonly Usage[],
  runId: string,
  role: ChapterRole,
) {
  const rows = usage.filter(
    (row) => row.run_id === runId && row.role_id === role,
  );
  if (rows.some((row) => row.charged_credits === null)) return null;
  if (
    rows.length === 0 ||
    rows.some((row) => !/^\d+$/.test(row.charged_credits ?? ""))
  )
    return undefined;
  return rows.reduce(
    (sum, row) => sum + BigInt(row.charged_credits ?? "0"),
    0n,
  );
}

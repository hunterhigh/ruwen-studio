import { fieldName, filesCopy, uiCopy } from "../../copy/zh-CN.ts";

export const registryPath = "治理/资源注册表.json";

export interface ProjectFile {
  path: string;
  sha256: string;
  text: string;
}

export interface ResourceEntry {
  id: string;
  path: string;
  status: string;
  scope?: Record<string, unknown>;
  readers?: string[];
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return undefined;
  }
}

export function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
}

export function parseRegistry(text: string | undefined) {
  if (text === undefined) return undefined;
  const rows = record(parseJson(text))?.resources;
  if (!Array.isArray(rows)) return undefined;
  const entries = new Map<string, ResourceEntry>();
  for (const row of rows) {
    const item = record(row);
    if (
      typeof item?.id !== "string" ||
      typeof item.path !== "string" ||
      entries.has(item.path)
    ) {
      return undefined;
    }
    const scope = record(item.scope);
    const readers = stringList(item.readers);
    entries.set(item.path, {
      id: item.id,
      path: item.path,
      status: typeof item.status === "string" ? item.status : "",
      ...(scope && { scope }),
      ...(readers && { readers }),
    });
  }
  return entries;
}

export function statusLabel(status: string): string {
  return mappedLabel(filesCopy.status, status) ?? filesCopy.unknownStatus;
}

function mappedLabel(labels: Record<string, string>, key: string) {
  return Object.hasOwn(labels, key) ? labels[key] : undefined;
}

export function statusTone(status: string) {
  if (status === "active") return "active";
  if (status === "candidate" || status === "proposed") return "pending";
  return "neutral";
}

export function fileName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function fileUrl(projectUrl: string, path: string) {
  return `${projectUrl}?path=${encodeURIComponent(path)}`;
}

function ledgerTime(entry: Record<string, unknown>) {
  for (const time of [
    entry.time,
    entry.recorded_at,
    entry.created_at,
    entry.createdAt,
    entry.timestamp,
  ]) {
    if (
      typeof time !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(time)
    )
      continue;
    const timestamp = Date.parse(time);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return undefined;
}

export function parseLedger(text: string) {
  const entries = [];
  let unreadable = 0;
  for (const [line, textLine] of text.split("\n").entries()) {
    if (!textLine.trim()) continue;
    const entry = record(parseJson(textLine));
    if (entry) entries.push({ line, entry, timestamp: ledgerTime(entry) });
    else unreadable++;
  }
  entries.sort(
    (first, second) =>
      (second.timestamp ?? -Infinity) - (first.timestamp ?? -Infinity) ||
      second.line - first.line,
  );
  return { entries, unreadable };
}

export function ledgerSummary(entry: Record<string, unknown>) {
  return (
    firstText(entry.summary, entry.title) ||
    auditLabel(entry.change) ||
    firstText(entry.location) ||
    filesCopy.ledgerRecord
  );
}

function firstText(...values: unknown[]) {
  return values.find(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
}

function auditLabel(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return mappedLabel(filesCopy.auditEvents, value) ?? filesCopy.ledgerRecord;
}

const technicalFields = new Set([
  "authorization",
  "billing",
  "cache",
  "cachehit",
  "cacheread",
  "cachewrite",
  "cost",
  "costtotal",
  "costusd",
  "model",
  "modelid",
  "modelname",
  "provider",
  "runtimemode",
  "securityevents",
  "systemprompt",
  "token",
  "tokens",
  "transcript",
  "usage",
  "usageunknown",
]);
const enumFields = new Set(["status", "role", "kind", "decision", "type"]);

function visibleField(key: string) {
  const normalized = key.toLowerCase().replace(/[_-]/g, "");
  return (
    !technicalFields.has(normalized) &&
    !/(sha256|hash|tokens|apikey|secret|password)$/.test(normalized)
  );
}

/** Adapt file-specific field labels to the shared structured renderer. */
export function fileKeyValues(
  value: unknown,
  field?: string,
  depth = 0,
): unknown {
  if (depth > 12) return uiCopy.limited;
  if (Array.isArray(value)) {
    return value.map((item) => fileKeyValues(item, field, depth + 1));
  }
  const object = record(value);
  if (object) {
    return Object.entries(object)
      .filter(([key]) => visibleField(key))
      .map(([key, item]) => ({
        name:
          mappedLabel(filesCopy.fields, key) ??
          mappedLabel(fieldName, key) ??
          key,
        content: fileKeyValues(item, key, depth + 1),
      }));
  }
  if (typeof value !== "string") return value;
  if (/^[a-f\d]{64}$/i.test(value)) return uiCopy.empty;
  if (field === "status" && Object.hasOwn(filesCopy.status, value))
    return statusLabel(value);
  if (field === "change") return auditLabel(value);
  if (field === "result" || field === "reason" || field === "approval_status") {
    const label = mappedLabel(filesCopy.auditEvents, value);
    if (label) return label;
  }
  if (
    (field === "approval_status" || field === "conflict_category") &&
    /^[a-z][a-z\d_-]*$/i.test(value)
  )
    return uiCopy.unknownValue;
  if (field && enumFields.has(field)) {
    return { [field === "type" ? "kind" : field]: value };
  }
  return value;
}

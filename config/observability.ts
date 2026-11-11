import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/node";
import models from "./models.json" with { type: "json" };

const events = new Set([
  "web_ready",
  "worker_ready",
  "worker_error",
  "startup_failed",
  "uncaught_error",
  "unhandled_rejection",
  "library_output",
  "library_error",
  "migration_complete",
  "migration_failed",
  "role_started",
  "role_completed",
]);
const errors = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "BillingError",
  "RoleExecutionError",
  "RoleTruncatedError",
]);
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const context = new AsyncLocalStorage<Record<string, string>>();
const write = process.stdout.write.bind(process.stdout);
let enabled = false;

/** Drop text by default, including Error.message/stack, SQL, URLs, headers and nested arbitrary fields. */
export function safeLogRecord(
  event: string,
  fields: Record<string, unknown> = {},
) {
  const record: Record<string, string | number> = {
    event: events.has(event) ? event : "library_output",
  };
  for (const key of ["run_id", "project_id"])
    if (typeof fields[key] === "string" && uuid.test(fields[key]))
      record[key] = fields[key];
  if (
    typeof fields.role_id === "string" &&
    Object.hasOwn(models.roles, fields.role_id)
  )
    record.role_id = fields.role_id;
  if (
    typeof fields.mode === "string" &&
    ["faux", "real", "record", "replay"].includes(fields.mode)
  )
    record.mode = fields.mode;
  if (typeof fields.error_type === "string" && errors.has(fields.error_type))
    record.error_type = fields.error_type;
  if (
    typeof fields.error_code === "string" &&
    [
      "ENOENT",
      "EACCES",
      "EROFS",
      "ERR_MODULE_NOT_FOUND",
      "MODULE_NOT_FOUND",
      "ERR_INVALID_URL",
      "ECONNREFUSED",
      "ENOTFOUND",
      "42P01",
      "42501",
      "28P01",
    ].includes(fields.error_code)
  )
    record.error_code = fields.error_code;
  for (const key of ["duration_ms", "attempt", "status"])
    if (
      typeof fields[key] === "number" &&
      Number.isFinite(fields[key]) &&
      fields[key] >= 0
    )
      record[key] = fields[key];
  return record;
}
/** Reconstruct, rather than redact arbitrary content heuristically. No manuscript or credentials can enter. */
export function safeSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  return {
    type: undefined,
    ...(event.event_id && /^[a-f0-9]{32}$/.test(event.event_id)
      ? { event_id: event.event_id }
      : {}),
    ...(Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
    platform: "node",
    level: "error",
    message: "ruwen_operational_error",
    tags: {
      ...safeLogRecord(
        String(event.tags?.event ?? "uncaught_error"),
        event.tags ?? {},
      ),
    },
  };
}
export function initializeObservability(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (!env.SENTRY_DSN?.trim()) return false;
  const dsn = new URL(env.SENTRY_DSN);
  if (dsn.protocol !== "https:") throw new Error("Sentry DSN requires HTTPS");
  Sentry.init({
    dsn: env.SENTRY_DSN,
    defaultIntegrations: false,
    integrations: [],
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    attachStacktrace: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    beforeSend: safeSentryEvent,
    beforeSendLog: () => null,
    beforeBreadcrumb: () => null,
  });
  enabled = true;
  return true;
}
export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  const record = safeLogRecord(event, { ...context.getStore(), ...fields });
  write(`${JSON.stringify(record)}\n`);
  if (enabled && /error|failed|rejection/.test(String(record.event)))
    Sentry.captureMessage("ruwen_operational_error", { tags: record });
}
export function reportError(
  event: string,
  error: unknown,
  fields: Record<string, unknown> = {},
) {
  logEvent(event, {
    ...fields,
    error_type: error instanceof Error ? error.name : "Error",
    error_code:
      error instanceof Error && "code" in error ? error.code : undefined,
  });
}
export const flushObservability = () =>
  enabled ? Sentry.flush(2000) : Promise.resolve(true);
export function withLogContext<T>(
  fields: Record<string, string>,
  work: () => T,
): T {
  return context.run(fields, work);
}
/** Container entrypoint guards third-party console output too; local preview output stays unchanged. */
export function protectConsole() {
  for (const method of ["log", "info", "warn", "error", "debug"] as const)
    console[method] = (...args: unknown[]) => {
      const error = args.find((arg) => arg instanceof Error);
      if (error) reportError("library_error", error);
      else logEvent("library_output");
    };
}

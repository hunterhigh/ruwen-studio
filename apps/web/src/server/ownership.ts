import { registry } from "@ruwen/core";
import { type Database, PostgresFS } from "@ruwen/db";
import { HttpError } from "./security.ts";
export type IdeationLocators = Partial<
  Record<
    "sessionId" | "previewId" | "taskId" | "decisionId" | "messageId",
    string
  >
>;
export type Resource =
  | {
      projectId: string;
      ideation?: IdeationLocators;
      resourceIds?: readonly string[];
    }
  | { runId: string };
type BillingResource =
  | { checkoutId: string }
  | { accountId: string }
  | { reservationId: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Every resource route, SSE subscriber and export calls this before reading or mutating a resource. */
export function requireOwnership(
  db: Database,
  userId: string,
  resource: Resource,
): Promise<{
  project: { id: string; project_key: string; title: string };
  fs: PostgresFS;
}>;
export function requireOwnership(
  db: Database,
  userId: string,
  resource: BillingResource,
  adminEmails?: string[],
): Promise<{ id: string }>;
export async function requireOwnership(
  db: Database,
  userId: string,
  resource: Resource | BillingResource,
  adminEmails: string[] = [],
) {
  if (
    "checkoutId" in resource ||
    "accountId" in resource ||
    "reservationId" in resource
  ) {
    const id =
      "checkoutId" in resource
        ? resource.checkoutId
        : "accountId" in resource
          ? resource.accountId
          : resource.reservationId;
    if (!uuid.test(id)) throw new HttpError(404, "资源不存在。");
    const result =
      "checkoutId" in resource
        ? await db.pool.query(
            "SELECT id FROM billing_checkouts WHERE id=$1 AND user_id=$2",
            [id, userId],
          )
        : "reservationId" in resource
          ? await db.pool.query(
              "SELECT id FROM credit_reservations WHERE id=$1 AND (user_id=$2 OR EXISTS(SELECT 1 FROM users actor WHERE actor.id=$2 AND lower(actor.email)=ANY($3::text[])))",
              [id, userId, adminEmails],
            )
          : await db.pool.query(
              "SELECT id FROM users WHERE id=$1 AND (id=$2 OR EXISTS(SELECT 1 FROM users actor WHERE actor.id=$2 AND lower(actor.email)=ANY($3::text[])))",
              [id, userId, adminEmails],
            );
    if (!result.rowCount) throw new HttpError(404, "资源不存在。");
    return { id };
  }
  const id = "projectId" in resource ? resource.projectId : resource.runId;
  if (!uuid.test(id)) throw new HttpError(404, "资源不存在。");
  const rows =
    "projectId" in resource
      ? await db.pool.query<{ id: string; project_key: string; title: string }>(
          "SELECT id,project_key,title FROM projects WHERE id=$1 AND owner_id=$2",
          [id, userId],
        )
      : await db.pool.query<{ id: string; project_key: string; title: string }>(
          "SELECT p.id,p.project_key,p.title FROM projects p JOIN pipeline_runs r ON r.project_id=p.id WHERE r.id=$1 AND p.owner_id=$2",
          [id, userId],
        );
  const project = rows.rows[0];
  if (!project) throw new HttpError(404, "资源不存在。");
  if ("projectId" in resource && resource.ideation) {
    const tables = {
      sessionId: ["ideation_sessions", "id"],
      previewId: ["ideation_previews", "id"],
      taskId: ["ideation_tasks", "run_id"],
      decisionId: ["ideation_decisions", "id"],
      messageId: ["ideation_messages", "id"],
    } as const;
    for (const key of Object.keys(
      resource.ideation,
    ) as (keyof IdeationLocators)[]) {
      const value = resource.ideation[key];
      if (!value || !uuid.test(value)) throw new HttpError(404, "资源不存在。");
      const [table, column] = tables[key];
      const owned = await db.pool.query(
        `SELECT 1 FROM ${table} WHERE project_id=$1 AND ${column}=$2`,
        [project.id, value],
      );
      if (!owned.rowCount) throw new HttpError(404, "资源不存在。");
      if (
        key === "messageId" &&
        !(
          await db.pool.query(
            "SELECT 1 FROM ideation_messages m JOIN ideation_sessions s ON s.id=m.session_id AND s.project_id=m.project_id WHERE m.id=$1 AND m.project_id=$2",
            [value, project.id],
          )
        ).rowCount
      )
        throw new HttpError(404, "资源不存在。");
    }
  }
  const fs = new PostgresFS(db, project.id, userId);
  if ("projectId" in resource && resource.resourceIds) {
    if (!(await fs.exists(registry.REGISTRY)))
      throw new HttpError(404, "资源不存在。");
    const data = await registry.readRegistry(fs);
    for (const id of resource.resourceIds)
      if (
        !data.resources.some(
          (r) =>
            r.id === id &&
            (r.scope.project === null ||
              r.scope.project === project.project_key),
        )
      )
        throw new HttpError(404, "资源不存在。");
  }
  return { project, fs };
}

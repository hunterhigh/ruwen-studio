import { type Database, PostgresFS } from "@ruwen/db";
import { HttpError } from "./security.ts";
export type Resource = { projectId: string } | { runId: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Every resource route, SSE subscriber and export calls this before reading or mutating a resource. */
export async function requireOwnership(
  db: Database,
  userId: string,
  resource: Resource,
) {
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
  return { project, fs: new PostgresFS(db, project.id, userId) };
}

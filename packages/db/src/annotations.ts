import type { Database } from "./database.ts";
import type { PostgresFS } from "./postgres-fs.ts";

export const annotationStatuses = ["open", "accepted", "dismissed"] as const;
export const annotationRatings = ["useful", "not_useful"] as const;
export type AnnotationStatus = (typeof annotationStatuses)[number];
export type AnnotationUsefulness = (typeof annotationRatings)[number] | null;
type AnnotationKind = "reader" | "editor" | "plot" | "reality";
export interface AnnotationDisposition {
  status: AnnotationStatus;
  usefulness: AnnotationUsefulness;
}
export interface Annotation extends AnnotationDisposition {
  id: string;
  roleId: string;
  index: number;
  kind: AnnotationKind;
}
export type AnnotationPatch = Partial<AnnotationDisposition>;
type AnnotationSource = Annotation & { finding: unknown };

export function isAnnotationId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}:(?:0|[1-9]\d{0,2})$/.test(
      value,
    )
  );
}

const findings = `CASE r.role_id
  WHEN 'qinggan-duzhe' THEN r.result->'output'->'reactions'
  WHEN 'wenxue-bianji' THEN r.result->'output'->'edits'
  WHEN 'qingjie-heyanyuan' THEN r.result->'output'->'issues'
  WHEN 'xianshi-heyanyuan' THEN r.result->'output'->'issues'
END`;
const kinds = `CASE r.role_id WHEN 'qinggan-duzhe' THEN 'reader'
  WHEN 'wenxue-bianji' THEN 'editor' WHEN 'qingjie-heyanyuan' THEN 'plot'
  WHEN 'xianshi-heyanyuan' THEN 'reality' END`;
const ordinal = "(item.ordinality - 1)";
const annotationId = `r.id::text || ':' || ${ordinal}::text`;
const items = `
  FROM role_runs r JOIN pipeline_runs p ON p.id=r.run_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(${findings})='array' THEN ${findings} ELSE '[]'::jsonb END
  ) WITH ORDINALITY item(finding, ordinality)
  LEFT JOIN annotation_dispositions d ON d.annotation_id=(${annotationId}) AND
    d.run_id::text=CASE WHEN p.kind='chapter_reverify' THEN p.request->>'parentId' ELSE p.id::text END`;
const fields = `${annotationId} AS id,r.role_id AS "roleId",${ordinal}::int AS index,
  ${kinds} AS kind,coalesce(d.status,'open') AS status,d.usefulness`;

export async function listRunAnnotations(
  db: Database,
  projectId: string,
  runId: string,
  verificationRunId?: string,
) {
  const { rows } = await db.pool.query<Annotation>(
    `SELECT ${fields} ${items}
     WHERE p.project_id=$2 AND r.status='completed' AND
       ((p.id=$1 AND p.kind='chapter_run' AND ($3::uuid IS NULL
       OR r.role_id NOT IN ('qingjie-heyanyuan','xianshi-heyanyuan')))
       OR (p.id=$3 AND p.kind='chapter_reverify' AND p.request->>'parentId'=$1::text
       AND r.role_id IN ('qingjie-heyanyuan','xianshi-heyanyuan')))
     ORDER BY r.started_at, r.id, item.ordinality`,
    [runId, projectId, verificationRunId ?? null],
  );
  return rows;
}

export async function findRunAnnotations(
  tx: PostgresFS,
  runId: string,
  ids: readonly string[],
) {
  const { rows } = await tx.sql<AnnotationSource>(
    `SELECT ${fields},item.finding ${items}
     WHERE p.project_id=$2 AND r.status='completed' AND r.id=ANY($4::uuid[])
       AND (${annotationId})=ANY($3::text[])
       AND ((p.id=$1 AND p.kind='chapter_run') OR
       (p.kind='chapter_reverify' AND p.request->>'parentId'=$1::text
        AND r.role_id IN ('qingjie-heyanyuan','xianshi-heyanyuan')))`,
    [runId, tx.projectId, ids, ids.map((id) => id.split(":")[0])],
  );
  return new Map(rows.map((row) => [row.id, row]));
}

export async function writeAnnotationDisposition(
  tx: PostgresFS,
  runId: string,
  annotation: Annotation,
  patch: AnnotationPatch,
) {
  const disposition = {
    status: patch.status ?? annotation.status,
    usefulness:
      patch.usefulness === undefined ? annotation.usefulness : patch.usefulness,
  };
  await tx.sql(
    `INSERT INTO annotation_dispositions(run_id,annotation_id,kind,status,usefulness,updated_by)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(run_id,annotation_id) DO UPDATE SET
       status=excluded.status,usefulness=excluded.usefulness,updated_by=excluded.updated_by,updated_at=now()`,
    [
      runId,
      annotation.id,
      annotation.kind,
      disposition.status,
      disposition.usefulness,
      tx.ownerId,
    ],
  );
  return { id: annotation.id, ...disposition };
}

export interface AnnotationStatsRow {
  kind: AnnotationKind;
  total: number;
  accepted: number;
  dismissed: number;
  useful: number;
  notUseful: number;
}

export async function annotationStats(db: Database, from: string, to: string) {
  return (
    await db.pool.query<AnnotationStatsRow>(
      `SELECT ${kinds} AS kind,count(*)::int AS total,
        count(*) FILTER (WHERE d.status='accepted')::int AS accepted,
        count(*) FILTER (WHERE d.status='dismissed')::int AS dismissed,
        count(*) FILTER (WHERE d.usefulness='useful')::int AS useful,
        count(*) FILTER (WHERE d.usefulness='not_useful')::int AS "notUseful"
     ${items}
     WHERE r.status='completed' AND (p.kind='chapter_run' OR
       (p.kind='chapter_reverify' AND r.role_id IN ('qingjie-heyanyuan','xianshi-heyanyuan')))
       AND r.finished_at>=($1::date::timestamp AT TIME ZONE 'UTC')
       AND r.finished_at<(($2::date+1)::timestamp AT TIME ZONE 'UTC')
     GROUP BY 1 ORDER BY 1`,
      [from, to],
    )
  ).rows;
}

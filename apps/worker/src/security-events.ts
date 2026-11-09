import type { RoleId, RoleResult } from "@ruwen/agents";
import type { PostgresFS } from "@ruwen/db";

/** Caller uses the same transaction as role result/usage persistence. No model text is stored. */
export async function recordRoleSecurityEvents(
  tx: PostgresFS,
  runId: string,
  roleId: RoleId,
  result: RoleResult,
): Promise<void> {
  for (const event of result.securityEvents ?? []) {
    if (
      ![
        "canary",
        "prompt_overlap",
        "internal_refusal",
        "content_refusal",
      ].includes(event.kind)
    )
      throw new Error("Invalid security event kind");
    await tx.sql(
      `INSERT INTO security_events(id,user_id,project_id,run_id,role_id,kind,score)
       SELECT $1,$2,$3,id,$4,$5,1 FROM pipeline_runs WHERE id=$6 AND project_id=$3
       ON CONFLICT DO NOTHING`,
      [event.id, tx.ownerId, tx.projectId, roleId, event.kind, runId],
    );
  }
}
export async function getSecurityRiskScore(fs: PostgresFS): Promise<number> {
  return fs.transaction(async (tx) => {
    const result = await tx.sql<{ score: string }>(
      "SELECT coalesce(sum(score),0)::text AS score FROM security_events WHERE user_id=$1",
      [fs.ownerId],
    );
    const score = Number(result.rows[0]?.score ?? 0);
    if (!Number.isSafeInteger(score))
      throw new Error("Security risk score overflow");
    return score;
  });
}

import type { RoleId } from "@ruwen/agents";
import type { InputManifest } from "@ruwen/core";
import type { PostgresFS } from "@ruwen/db";

export async function persistInputManifest(
  fs: PostgresFS,
  runId: string,
  role: RoleId,
  manifest: InputManifest,
): Promise<void> {
  await fs.transaction(async (tx) => {
    const saved = await tx.sql(
      "UPDATE role_runs r SET input_manifest=$4 FROM pipeline_runs p WHERE r.run_id=p.id AND r.run_id=$1 AND r.role_id=$2 AND p.project_id=$3 AND r.status='running'",
      [runId, role, fs.projectId, JSON.stringify(manifest)],
    );
    if (saved.rowCount !== 1)
      throw new Error("Role input manifest has no active role run");
  });
}

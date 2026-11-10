import type { RoleId } from "@ruwen/agents";
import type { Database } from "@ruwen/db";
import { runtimeSettings } from "../../../config/settings.ts";
/** Sole input: security-approved RoleContext.onDelta, never provider events or transcript text. */
export function streamSink(
  db: Database,
  projectId: string,
  runId: string,
  onError?: (error: Error) => void,
) {
  const pending = new Map<RoleId, string>();
  let tail = Promise.resolve();
  const flush = () => {
    const entries = [...pending];
    pending.clear();
    if (!entries.length) return;
    tail = tail
      .then(async () => {
        for (const [role, delta] of entries)
          await db.pool.query(
            "INSERT INTO web_run_events(project_id,run_id,role_id,delta) SELECT $1,$2,$3,$4 WHERE EXISTS(SELECT 1 FROM pipeline_runs WHERE id=$2 AND project_id=$1)",
            [projectId, runId, role, delta],
          );
      })
      .catch((error) => onError?.(error as Error));
  };
  const timer = setInterval(flush, runtimeSettings().stream.pollIntervalMs);
  return {
    push(delta: string, role: RoleId) {
      pending.set(role, (pending.get(role) ?? "") + delta);
    },
    async finish() {
      clearInterval(timer);
      flush();
      await tail;
    },
  };
}

import type {
  AttemptResetReason,
  RoleId,
  RoleStreamEvent,
} from "@ruwen/agents";
import type { Database } from "@ruwen/db";
import { runtimeSettings } from "../../../config/settings.ts";
/** Sole input: security-approved RoleContext.onDelta, never provider events or transcript text. */
export function streamSink(
  db: Database,
  projectId: string,
  runId: string,
  onError?: (error: Error) => void,
) {
  let pending: RoleStreamEvent[] = [];
  let tail = Promise.resolve();
  let failure: Error | undefined;
  const flush = () => {
    const entries = pending;
    pending = [];
    if (!entries.length) return;
    tail = tail
      .then(async () => {
        if (failure) return;
        for (const event of entries)
          await db.pool.query(
            "INSERT INTO web_run_events(project_id,run_id,role_id,delta,event_type,reset_reason) SELECT $1,$2,$3,$4,$5,$6 WHERE EXISTS(SELECT 1 FROM pipeline_runs WHERE id=$2 AND project_id=$1)",
            [
              projectId,
              runId,
              event.role,
              event.type === "delta" ? event.text : "",
              event.type,
              event.type === "reset" ? event.reason : null,
            ],
          );
      })
      .catch((error) => {
        failure = error as Error;
        onError?.(failure);
      });
  };
  const timer = setInterval(flush, runtimeSettings().stream.pollIntervalMs);
  return {
    push(delta: string, role: RoleId) {
      const previous = pending.at(-1);
      if (previous?.type === "delta" && previous.role === role)
        previous.text += delta;
      else pending.push({ type: "delta", role, text: delta });
    },
    reset(role: RoleId, reason: AttemptResetReason) {
      // Barrier: never combine text from opposite sides of a reset, even before a timer tick.
      flush();
      pending.push({ type: "reset", role, reason });
      flush();
    },
    async finish() {
      clearInterval(timer);
      flush();
      await tail;
      if (failure) throw failure;
    },
  };
}

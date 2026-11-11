import {
  assertRunEnabled,
  BillingError,
  finishReservation,
  quoteRun,
  type RunQuote,
  reserveRun,
  type Sql,
} from "@ruwen/billing";
import { runtimeSettings } from "../../../config/settings.ts";
import type { IdeationSessionOptions } from "../../../packages/pipeline/src/ideation/sessions.ts";
import { IdeationFailure } from "../../../packages/pipeline/src/ideation/sessions.ts";
import type { IdeationTransaction } from "../../../packages/pipeline/src/ideation/store.ts";

export const ideationSql = (tx: IdeationTransaction): Sql => ({
  query: (query, values) => tx.sql(query, values),
});
/** Only connects to the main thread's ledger/guard API; no pricing or freeze decisions here. */
export function withIdeationBilling(
  options: IdeationSessionOptions,
): IdeationSessionOptions {
  const quotes = new WeakMap<IdeationTransaction, Map<string, RunQuote>>();
  return {
    ...options,
    beforeRun: async (tx, actor, runId) => {
      const exists = await tx.sql(
        "SELECT 1 FROM pipeline_runs WHERE id=$1 AND project_id=$2",
        [runId, actor.projectId],
      );
      if (exists.rowCount)
        await assertRunEnabled(ideationSql(tx), actor.userId, runId);
      else {
        const quote = await quoteRun(
          ideationSql(tx),
          actor.userId,
          ["real", "record"].includes(options.modelMode) ? "live" : "sandbox",
          "ideation",
        );
        const pending = quotes.get(tx) ?? new Map<string, RunQuote>();
        pending.set(runId, quote);
        quotes.set(tx, pending);
      }
      return options.beforeRun?.(tx, actor, runId);
    },
    onRunAccepted: async (tx, actor, runId) => {
      const policy = runtimeSettings().riskReview;
      const turns = await tx.sql<{ count: number }>(
        "SELECT count(*)::int count FROM pipeline_runs p JOIN pipeline_runs admitted ON admitted.id=$1 AND admitted.project_id=$2 AND admitted.kind='ideation_coordinator' WHERE p.project_id=$2 AND p.kind='ideation_coordinator' AND p.request->>'sessionId'=admitted.request->>'sessionId' AND p.created_at>now()-($3::double precision*interval '1 second')",
        [runId, actor.projectId, policy.coordinatorWindowSeconds],
      );
      if ((turns.rows[0]?.count ?? 0) > policy.coordinatorTurnsPerHour)
        throw new IdeationFailure("RATE_LIMITED");
      const quote = quotes.get(tx)?.get(runId);
      if (!quote || quote.userId !== actor.userId)
        throw new BillingError("PRECONDITION_FAILED", 409, "运行报价已失效。");
      await reserveRun(ideationSql(tx), runId, quote);
      quotes.get(tx)?.delete(runId);
      return options.onRunAccepted?.(tx, actor, runId);
    },
    onTaskTerminal: async (tx, actor, runId) => {
      await finishReservation(ideationSql(tx), actor.userId, runId);
      await options.onTaskTerminal?.(tx, actor, runId);
    },
  };
}

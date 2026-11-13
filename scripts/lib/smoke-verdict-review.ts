import type { WorkerOptions } from "../../apps/worker/src/service.ts";
import { ledgers } from "../../packages/core/src/index.ts";

export interface SmokeVerdictReview {
  testOnly: true;
  actor: "smoke-test-user";
  decision: "human_rejects_verdict";
  label: "人类驳回核验意见";
  source: "--continue-on-verdict";
  role: "qingjie-heyanyuan" | "xianshi-heyanyuan";
  runId: string;
  candidateSha256: string;
  originalVerdict: Parameters<
    NonNullable<WorkerOptions["smokeVerdictReview"]>
  >[2];
  audit: Awaited<ReturnType<typeof ledgers.appendAudit>>;
}

/** Harness-only, hash-bound adjudication. The original role output is never edited. */
export function smokeVerdictReviewer(
  reviews: SmokeVerdictReview[],
): NonNullable<WorkerOptions["smokeVerdictReview"]> {
  return async (fs, role, verdict, run) => {
    if (
      !["qingjie-heyanyuan", "xianshi-heyanyuan"].includes(role) ||
      verdict.pass !== false ||
      !run.paths.candidate
    )
      throw new Error(
        "Only a failed verifier verdict may be reviewed by the smoke harness",
      );
    const candidatePath = run.paths.candidate;
    const record = await fs.transaction(async (tx) => {
      const candidateSha256 = await tx.sha256(candidatePath);
      const file = `authoring-ruwen-v5/reports/runs/${run.id}/smoke-verdict-review-${role}.json`;
      if (await tx.exists(file)) {
        const saved = JSON.parse(await tx.readText(file)) as SmokeVerdictReview;
        if (
          saved.candidateSha256 !== candidateSha256 ||
          saved.role !== role ||
          saved.runId !== run.id ||
          JSON.stringify(saved.originalVerdict) !== JSON.stringify(verdict)
        )
          throw new Error("Smoke verdict review is stale");
        return saved;
      }
      const audit = await ledgers.appendAudit(tx, {
        role: "smoke-test-user",
        resource_ids: [],
        change: "human_rejects_verdict",
        scope: {
          project: run.projectKey,
          volume: null,
          arc: null,
          chapter: run.chapter,
        },
        conflict_category: "verdict_review",
        approval_status: "approved",
        result: "smoke_only_continue",
      });
      const value: SmokeVerdictReview = {
        testOnly: true,
        actor: "smoke-test-user",
        decision: "human_rejects_verdict",
        label: "人类驳回核验意见",
        source: "--continue-on-verdict",
        role,
        runId: run.id,
        candidateSha256,
        originalVerdict: verdict,
        audit,
      };
      await tx.createExclusive(file, `${JSON.stringify(value, null, 2)}\n`);
      return value;
    });
    if (
      !reviews.some(
        (saved) => saved.runId === record.runId && saved.role === role,
      )
    )
      reviews.push(record);
    return true;
  };
}

export class SmokeFlowStop extends Error {
  constructor(
    readonly reason: string,
    readonly returnedTo: string | undefined,
  ) {
    super("流程按设计停止");
  }
}

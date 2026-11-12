import type { runP3Smoke } from "./p3-smoke.ts";
export function smokePlan(report: Awaited<ReturnType<typeof runP3Smoke>>) {
  let cumulativeUsd = 0,
    blockedAt: number | null = null;
  const requests = report.planned.map((request, index) => {
    const before = cumulativeUsd;
    cumulativeUsd = Math.ceil((cumulativeUsd + request.boundUsd) * 1e10) / 1e10;
    if (
      blockedAt === null &&
      (before >= report.maxUsd || cumulativeUsd > report.maxUsd)
    )
      blockedAt = index + 1;
    return {
      ...request,
      step: index + 1,
      cumulativeUsd,
      status:
        blockedAt === null
          ? "RUN"
          : blockedAt === index + 1
            ? "BLOCK"
            : "AFTER_BLOCK",
    };
  });
  return {
    profile: report.profile,
    scenario: report.scenario,
    maxUsd: report.maxUsd,
    totalBoundUsd: cumulativeUsd,
    canFinish: report.status === "completed" && blockedAt === null,
    blockedAt,
    providerCalls: report.providerCalls,
    failure: report.failure,
    requests,
  };
}
export function formatSmokePlan(plan: ReturnType<typeof smokePlan>) {
  return [
    `P3 PLAN max-usd=${plan.maxUsd}; profile=${plan.profile}; config/models${plan.profile === "deepseek" ? ".deepseek" : ""}.json; ${plan.scenario === "custom" ? "custom input, local illustrative replies" : "local demo replies"}; provider calls=${plan.providerCalls}`,
    ...plan.requests.map(
      (r) =>
        `${String(r.step).padStart(2, "0")} ${r.phase}/${r.role} ${r.model.split("/").at(-1)} in<=${r.inputTokens} out<=${r.outputTokens} USD<=${r.boundUsd.toFixed(10)} cumulative<=${r.cumulativeUsd.toFixed(10)} ${r.status}`,
    ),
    `Demo can finish: ${plan.canFinish ? "YES" : "NO"}; first blocked step: ${plan.blockedAt ?? "none"}; total USD<=${plan.totalBoundUsd.toFixed(10)}`,
    plan.scenario === "custom"
      ? "Scope: actual custom input with illustrative local replies and tool turns, not a prediction of live content; live outputs/corrections change later requests and are rechecked before dispatch."
      : "Scope: fixed demo transcript, including its tool turns; live outputs/corrections change later requests and are rechecked before dispatch.",
    ...(plan.failure ? [`Planning failed: ${plan.failure}`] : []),
  ].join("\n");
}

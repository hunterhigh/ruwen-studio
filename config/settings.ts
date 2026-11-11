import { readFileSync } from "node:fs";
import defaults from "./runtime.json" with { type: "json" };
export type RuntimeSettings = typeof defaults;
export function runtimeSettings(): RuntimeSettings {
  const settings = JSON.parse(
    readFileSync(new URL("./runtime.json", import.meta.url), "utf8"),
  ) as RuntimeSettings;
  if (
    ![
      settings.execution.concurrency,
      settings.execution.queueMarginSeconds,
      settings.billing.costMarkup,
      settings.billing.creditsPerUsd,
      settings.billing.signupCredits,
      ...Object.values(settings.billing.defaultReservations),
      ...settings.billing.plans.map((plan) => plan.credits),
      ...settings.billing.plans.map((plan) => plan.priceMinor),
      settings.billing.payment.maxWebhookBytes,
      settings.billing.payment.webhookSkewSeconds,
      settings.billing.payment.requestTimeoutMs,
      settings.riskReview.freezeScore,
      settings.riskReview.userChapterConcurrency,
      settings.riskReview.coordinatorTurnsPerHour,
      settings.riskReview.coordinatorWindowSeconds,
      settings.riskReview.dailyPlanPercent,
      settings.riskReview.dailyMaximumCredits,
      settings.stream.pollIntervalMs,
      settings.stream.heartbeatMs,
      settings.stream.maxConnectionMs,
      ...Object.values(settings.ideationDemo),
      settings.preview.sessionHours,
      ...Object.values(settings.security),
    ].every((value) => Number.isFinite(value) && value > 0) ||
    ![
      settings.release.p3GatePassed,
      settings.release.realChargingEnabled,
      settings.release.inviteOnly,
      settings.billing.payment.sandboxEnabled,
    ].every((value) => typeof value === "boolean") ||
    ![
      settings.billing.signupCredits,
      ...Object.values(settings.billing.defaultReservations),
      ...settings.billing.plans.flatMap((plan) => [
        plan.credits,
        plan.priceMinor,
      ]),
    ].every(Number.isSafeInteger) ||
    !settings.billing.plans.some(
      (p) => p.id === settings.riskReview.dailyDefaultPlanId,
    ) ||
    !Array.isArray(settings.riskReview.disposableEmailDomains) ||
    !settings.riskReview.disposableEmailDomains.every((d) =>
      /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(d),
    ) ||
    ![
      settings.riskReview.coordinatorTurnsPerHour,
      settings.riskReview.coordinatorWindowSeconds,
      settings.riskReview.dailyMaximumCredits,
      settings.riskReview.dailyPlanPercent,
      settings.riskReview.userChapterConcurrency,
    ].every(Number.isSafeInteger) ||
    settings.riskReview.dailyPlanPercent > 100
  )
    throw new Error(
      "Invalid runtime settings; placeholders must be explicit positive values and release gates must be boolean",
    );
  return settings;
}
export function releasePolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const config = runtimeSettings().release;
  const p3GatePassed =
    env.P3_GATE_PASSED === "1" ||
    (env.P3_GATE_PASSED === undefined && config.p3GatePassed);
  const requestedCharging =
    env.REAL_CHARGING_ENABLED === "1" ||
    (env.REAL_CHARGING_ENABLED === undefined && config.realChargingEnabled);
  return {
    p3GatePassed,
    realChargingEnabled: p3GatePassed && requestedCharging,
    inviteOnly: !p3GatePassed || (env.INVITE_ONLY !== "0" && config.inviteOnly),
  };
}
export function assertRealChargingAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (!releasePolicy(env).realChargingEnabled)
    throw new Error("真实收费尚未开放：须先通过P3并明确启用收费开关");
}

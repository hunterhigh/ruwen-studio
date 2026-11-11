import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { runP3Ping } from "../../../scripts/lib/p3-ping.ts";
import { createFauxRuntime } from "../src/index.ts";

it("uses exactly two faux dispatches, small output ceilings and no hidden retries", async () => {
  let count = 0;
  const runtime = createFauxRuntime([
    () => {
      count++;
      return fauxAssistantMessage("PONG");
    },
    () => {
      count++;
      return fauxAssistantMessage(fauxToolCall("p3_ping", { ok: true }), {
        stopReason: "toolUse",
      });
    },
  ]);
  const call = vi.spyOn(runtime.models, "streamSimple");
  const report = await runP3Ping(runtime);
  expect(report.ok).toBe(true);
  expect(count).toBe(2);
  expect(call).toHaveBeenCalledTimes(2);
  expect(call.mock.calls.map((c) => c[2]?.maxTokens)).toEqual([128, 1024]);
  expect(call.mock.calls.every((c) => c[2]?.maxRetries === 0)).toBe(true);
  expect(report.costUsd).toBeLessThanOrEqual(report.capUsd);
  expect(JSON.stringify(report)).not.toContain("PONG");
});
it("reports an invalid structured reply without making a corrective request", async () => {
  const runtime = createFauxRuntime([
    fauxAssistantMessage("PONG"),
    fauxAssistantMessage("PONG"),
  ]);
  const call = vi.spyOn(runtime.models, "streamSimple");
  const report = await runP3Ping(runtime);
  expect(report.ok).toBe(false);
  expect(report.checks[1]?.ok).toBe(false);
  expect(call).toHaveBeenCalledTimes(2);
});

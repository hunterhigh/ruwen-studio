import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { checks, normalizeSecurityText } from "@ruwen/core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { temporaryProject } from "../../core/test/helpers.ts";
import {
  createFauxRuntime,
  FAUX_PROSE,
  type RoleStreamEvent,
  runRole,
} from "../src/index.ts";
import {
  deploymentCanary,
  GENERAL_SECURITY_NOTE,
} from "../src/security/notes.ts";
import { INTERNAL_REFUSAL } from "../src/security/role-security.ts";

let project: Awaited<ReturnType<typeof temporaryProject>>;
beforeAll(async () => {
  project = await temporaryProject();
});
afterAll(async () => {
  await project?.cleanup();
});
const text = (events: RoleStreamEvent[]) =>
  events
    .flatMap((event) => (event.type === "delta" ? [event.text] : []))
    .join("");

it("author candidateProseErrors correction emits delta → reset → delta and discards the old withheld suffix", async () => {
  const invalid = `${"院外的雨落在河面上。".repeat(12)}\n# 自检\n本章逐项落实了大纲要求。`;
  expect(checks.candidateProseErrors(invalid)).not.toEqual([]);
  const runtime = createFauxRuntime([
    fauxAssistantMessage(invalid),
    fauxAssistantMessage(FAUX_PROSE),
  ]);
  const events: RoleStreamEvent[] = [];
  const result = await runRole(
    "xiaoshuo-zuozhe",
    { packet: "测试资料包" },
    {
      fs: project.fs,
      projectKey: "test-project",
      runtime,
      onDelta: (delta, role) =>
        events.push({ type: "delta", role, text: delta }),
      onAttemptReset: (role, reason) =>
        events.push({ type: "reset", role, reason }),
      onRequest: () => {
        if (runtime.faux.state.callCount === 1)
          expect(events.at(-1)).toEqual({
            type: "reset",
            role: "xiaoshuo-zuozhe",
            reason: "format_correction",
          });
      },
    },
  );
  const reset = events.findIndex((event) => event.type === "reset");
  expect(reset).toBeGreaterThan(0);
  expect(events.filter((event) => event.type === "reset")).toHaveLength(1);
  expect(invalid.startsWith(text(events.slice(0, reset)))).toBe(true);
  expect(text(events.slice(reset + 1))).toBe(FAUX_PROSE);
  expect(result.output).toBe(FAUX_PROSE);
  expect(result.usage).toHaveLength(2);
});

it("coordinator leakage emits safe deltas → reset → exact refusal, without exposing rejected content", async () => {
  const prefix = "桥边的雨还没有停，我们继续讨论人物眼前的处境。".repeat(8);
  const runtime = createFauxRuntime([
    fauxAssistantMessage(`${prefix}${deploymentCanary()}`),
  ]);
  const events: RoleStreamEvent[] = [];
  const result = await runRole(
    "chuangyi-xietiaoyuan",
    { raw_user_text: "继续聊故事" },
    {
      fs: project.fs,
      projectKey: "test-project",
      runtime,
      onDelta: (delta, role) =>
        events.push({ type: "delta", role, text: delta }),
      onAttemptReset: (role, reason) =>
        events.push({ type: "reset", role, reason }),
    },
  );
  const reset = events.findIndex((event) => event.type === "reset");
  expect(reset).toBeGreaterThan(0);
  expect(events[reset]).toEqual({
    type: "reset",
    role: "chuangyi-xietiaoyuan",
    reason: "security_refusal",
  });
  expect(prefix.startsWith(text(events.slice(0, reset)))).toBe(true);
  expect(text(events.slice(reset + 1))).toBe(INTERNAL_REFUSAL);
  expect(result.output).toBe(INTERNAL_REFUSAL);
  expect(JSON.stringify(events)).not.toContain(deploymentCanary());
  expect(runtime.faux.state.callCount).toBe(1);
});

it("structured overlap correction resets exactly once before its second provider request", async () => {
  const quote = GENERAL_SECURITY_NOTE.split("\n")[1] ?? "";
  const reading = (note: string) =>
    fauxAssistantMessage(
      fauxToolCall("submit_reading", {
        reactions: [{ anchor: "正文", type: "noticed", note }],
      }),
      { stopReason: "toolUse" },
    );
  const runtime = createFauxRuntime([
    reading(quote),
    reading("读到了人物的迟疑"),
  ]);
  const events: RoleStreamEvent[] = [];
  await runRole(
    "qinggan-duzhe",
    { prose: "正文" },
    {
      fs: project.fs,
      projectKey: "test-project",
      runtime,
      onAttemptReset: (role, reason) =>
        events.push({ type: "reset", role, reason }),
      onRequest: () => {
        if (runtime.faux.state.callCount === 1)
          expect(events).toEqual([
            {
              type: "reset",
              role: "qinggan-duzhe",
              reason: "prompt_overlap_correction",
            },
          ]);
      },
    },
  );
  expect(events).toEqual([
    {
      type: "reset",
      role: "qinggan-duzhe",
      reason: "prompt_overlap_correction",
    },
  ]);
  expect(runtime.faux.state.callCount).toBe(2);
});
it("format reset discards old display text without weakening cross-message privacy checks", async () => {
  const quote = Array.from(normalizeSecurityText(GENERAL_SECURITY_NOTE)).slice(
    0,
    60,
  );
  const runtime = createFauxRuntime([
    fauxAssistantMessage(quote.slice(0, 30).join("")),
    fauxAssistantMessage(quote.slice(30).join("")),
    fauxAssistantMessage(fauxToolCall("submit_reading", { reactions: [] }), {
      stopReason: "toolUse",
    }),
  ]);
  const reasons: string[] = [];
  const result = await runRole(
    "qinggan-duzhe",
    { prose: "正文" },
    {
      fs: project.fs,
      projectKey: "test-project",
      runtime,
      onAttemptReset: (_role, reason) => reasons.push(reason),
    },
  );
  expect(reasons).toEqual(["format_correction", "prompt_overlap_correction"]);
  expect(result.usage).toHaveLength(3);
  expect(result.securityEvents?.map((event) => event.kind)).toEqual([
    "prompt_overlap",
  ]);
});

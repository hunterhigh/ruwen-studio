import {
  fauxAssistantMessage,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { afterAll, beforeAll, expect, it } from "vitest";
import { temporaryProject } from "../../core/test/helpers.ts";
import {
  createFauxRuntime,
  type Data,
  RoleOutputError,
  runRole,
} from "../src/index.ts";
import { proseMatches } from "../src/tools/prose-anchors.ts";

let project: Awaited<ReturnType<typeof temporaryProject>>;
beforeAll(async () => {
  project = await temporaryProject();
});
afterAll(async () => {
  await project.cleanup();
});
const original = "林川不知道那布条是做什么用的。也许是伤了，也许只是冷。";
const changed = "他不知道那布条是做什么用的。也许是伤了，也许只是冷。";
const prose = `${original}\n粮车已经离开驿站。风从河谷吹来，院子里的人还在等待。`;
const reaction = (anchor: string): Data => ({
  anchor,
  type: "noticed",
  note: "我留意到人物仍在等待。",
});
const valid = [original, "粮车已经离开驿站。", "风从河谷吹来"].map(reaction);
const reading = (reactions: Data[]) =>
  fauxAssistantMessage(fauxToolCall("submit_reading", { reactions }), {
    stopReason: "toolUse",
  });
const ctx = (runtime: ReturnType<typeof createFauxRuntime>) => ({
  fs: project.fs,
  projectKey: "test-project",
  runtime,
});

it("aligns the real-run pronoun error to the original full passage, without a provider retry", async () => {
  const runtime = createFauxRuntime([
    reading([reaction(changed), ...valid.slice(1)]),
  ]);
  const result = await runRole("qinggan-duzhe", { prose }, ctx(runtime));
  const output = result.output as Data;
  expect((output.reactions as Data[])[0]).toMatchObject({
    anchor: original,
    anchor_adjusted: {
      original_anchor: changed,
      similarity: expect.any(Number),
    },
  });
  expect(runtime.faux.state.callCount).toBe(1);
  expect(
    proseMatches(prose, changed).unique?.similarity,
  ).toBeGreaterThanOrEqual(0.85);
});
it("does not auto-align two distinct similar occurrences and restores original Unicode/whitespace", () => {
  expect(
    proseMatches(`${original}\n${original}`, changed).unique,
  ).toBeUndefined();
  expect(
    proseMatches("ＡＢＣ　骑手缓缓走进院门。", "ABC骑手缓缓走进院门。").unique
      ?.text,
  ).toBe("ＡＢＣ　骑手缓缓走进院门。");
  expect(
    proseMatches("院门关闭。", "另一座星球的陌生故事").unique,
  ).toBeUndefined();
});
it("lists each bad anchor and a literal prose suggestion, then drops unrelated reactions after one correction", async () => {
  const bad = [
    ...valid,
    reaction("星际舰队已经飞出银河系"),
    reaction("遥远海洋里的陌生鲸群"),
  ];
  const requests: TranscriptContext[] = [];
  const runtime = createFauxRuntime([reading(bad), reading(bad)]);
  const result = await runRole(
    "qinggan-duzhe",
    { prose },
    { ...ctx(runtime), onRequest: (r) => requests.push(r) },
  );
  const output = result.output as Data;
  expect(output.reactions).toEqual(valid);
  expect(output.dropped_reactions).toHaveLength(2);
  const correction = requests[1]?.messages.findLast((m) => m.role === "user");
  const text = JSON.stringify(correction);
  for (const r of bad.slice(3)) expect(text).toContain(r.anchor);
  expect(text).toContain("原样复制");
  expect(result.failures).toEqual([
    {
      role: "qinggan-duzhe",
      attempt: 1,
      error: expect.stringContaining("Prose anchors must quote"),
    },
  ]);
  const issues = JSON.parse(
    result.failures?.[0]?.error.split(": ").slice(1).join(": ") ?? "[]",
  );
  for (const issue of issues) expect(prose).toContain(issue.closest);
  expect(runtime.faux.state.callCount).toBe(2);
});
it.each([
  2, 7,
])("fails when fewer than three valid reactions or less than half of %i submitted reactions survive", async (total) => {
  const reactions =
    total === 2
      ? valid.slice(0, 2)
      : [
          ...valid,
          ...Array.from({ length: 4 }, () =>
            reaction("星际舰队已经飞出银河系"),
          ),
        ];
  const runtime = createFauxRuntime([reading(reactions), reading(reactions)]);
  const failure = await runRole("qinggan-duzhe", { prose }, ctx(runtime)).catch(
    (e) => e,
  );
  expect(failure).toBeInstanceOf(RoleOutputError);
  expect(failure.message).toContain("Insufficient valid reader reactions");
  expect(failure.partial.failures).toEqual([
    { role: "qinggan-duzhe", attempt: 1, error: expect.any(String) },
    {
      role: "qinggan-duzhe",
      attempt: 2,
      error: expect.stringContaining("Insufficient valid reader reactions"),
    },
  ]);
  expect(runtime.faux.state.callCount).toBe(2);
});
it("accepts exactly half when three valid reactions survive", async () => {
  const bad = [
    ...valid,
    ...Array.from({ length: 3 }, () => reaction("星际舰队已经飞出银河系")),
  ];
  const result = await runRole(
    "qinggan-duzhe",
    { prose },
    ctx(createFauxRuntime([reading(bad), reading(bad)])),
  );
  expect((result.output as Data).reactions).toHaveLength(3);
});
it("keeps editor replacement anchors strict and gives literal corrections without changing or dropping edits", async () => {
  const edit = (anchor: string) =>
    fauxAssistantMessage(
      fauxToolCall("submit_edit", {
        decision: "LOCAL_EDIT",
        edits: [
          {
            anchor_before: anchor,
            anchor_after: "粮车已经离开驿站。",
            replacement: "\n",
            kind: "literary",
            reason: "保留段落间距。",
          },
        ],
        problems: [],
      }),
      { stopReason: "toolUse" },
    );
  const requests: TranscriptContext[] = [];
  const runtime = createFauxRuntime([edit(changed), edit(changed)]);
  const failure = await runRole(
    "wenxue-bianji",
    { prose, reading: { reactions: valid } },
    { ...ctx(runtime), onRequest: (r) => requests.push(r) },
  ).catch((e) => e);
  expect(failure).toBeInstanceOf(RoleOutputError);
  expect(failure.partial.output).toBe("");
  expect(
    JSON.stringify(requests[1]?.messages.findLast((m) => m.role === "user")),
  ).toContain(original);
  expect(
    failure.partial.failures.map((f: { attempt: number }) => f.attempt),
  ).toEqual([1, 2]);
  const corrected = await runRole(
    "wenxue-bianji",
    { prose, reading: { reactions: valid } },
    ctx(createFauxRuntime([edit(changed), edit(original)])),
  );
  expect((corrected.output as Data).edits).toHaveLength(1);
  expect(corrected.failures?.[0]).toMatchObject({
    role: "wenxue-bianji",
    attempt: 1,
  });
});

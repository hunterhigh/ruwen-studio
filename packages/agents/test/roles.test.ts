import {
  fauxAssistantMessage,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { state } from "@ruwen/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CANDIDATE,
  makeApproval,
  preparePacket,
  scope,
  temporaryProject,
} from "../../core/test/helpers.ts";
import { defaultFauxResponse, fauxOutput } from "../src/faux.ts";
import {
  assemblePrompt,
  createFauxRuntime,
  type Data,
  FAUX_PROSE,
  ROLE_IDS,
  ROLES,
  type RoleContext,
  type RoleId,
  RoleOutputError,
  RoleTurnLimitError,
  runRole,
} from "../src/index.ts";

let project: Awaited<ReturnType<typeof temporaryProject>>;
let authorPacket: string;
beforeAll(async () => {
  project = await temporaryProject();
  const fs = project.fs;
  authorPacket = await fs.readText(await preparePacket(fs));
  await fs.write(CANDIDATE, FAUX_PROSE);
  const event = await makeApproval(
    fs,
    CANDIDATE,
    "candidate_approve",
    "agent-test-approved",
  );
  await state.recordApproved(fs, CANDIDATE, "v1", event);
  await state.promoteApproved(fs, "chapters/001.md");
});
afterAll(async () => {
  await project.cleanup();
});
function input(id: RoleId): Data {
  if (id === "chuangyi-xietiaoyuan")
    return {
      raw_user_text: "我想继续讨论人物的处境与故事方向。",
      project_state: { project: "test-project" },
    };
  return {
    packet: authorPacket.replace(/\r\n/g, "\n"),
    prose: FAUX_PROSE,
    approved_prose: FAUX_PROSE,
    reading: { reactions: [] },
    chapter: "001",
    scope: scope(),
    brief: {
      fixed: [],
      creative_value: "人物的相互牵制",
      unresolved_forces: [],
      open_realization: [],
      destination: "故事/",
      excluded_source: [],
    },
    resources: [],
    approved_resources: [],
    locked_events: [],
    locked_order: [],
    hard_rules: "人物不能凭空知道他人信息。",
  };
}
function context(runtime = createFauxRuntime()): RoleContext {
  return { fs: project.fs, projectKey: "test-project", runtime };
}
describe.each(ROLE_IDS)("%s", (id) => {
  it("assembles only its own prompt sources and produces a valid faux result", async () => {
    const prompt = await assemblePrompt(ROLES[id]);
    expect(prompt.content).toMatchSnapshot(`${id} assembled system prompt`);
    const result = await runRole(id, input(id), context());
    expect(result.output).toEqual(fauxOutput(id, input(id)));
    expect(result.promptSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.costTotal).toBe(0);
    expect(result.usage).toHaveLength(1);
  });
  it("adds exactly one correction when a required submission is missing", async () => {
    const runtime = createFauxRuntime([
      fauxAssistantMessage(
        id === "xiaoshuo-zuozhe"
          ? "# 规划说明\n解释执行要求。"
          : "ordinary text instead of submission",
      ),
      defaultFauxResponse,
    ]);
    const requests: TranscriptContext[] = [];
    const result = await runRole(id, input(id), {
      ...context(runtime),
      onRequest: (ctx) => requests.push(ctx),
    });
    expect(runtime.faux.state.callCount).toBe(2);
    expect(result.usage).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain("上次输出未通过");
  });
  it("rejects two invalid output attempts without silently accepting coercion", async () => {
    const spec = ROLES[id];
    const bad = () =>
      spec.output.kind === "text"
        ? fauxAssistantMessage("# 自检\n本章逐项落实了大纲要求。")
        : fauxAssistantMessage(fauxToolCall(spec.output.toolName, {}), {
            stopReason: "toolUse",
          });
    const runtime = createFauxRuntime([bad(), bad(), defaultFauxResponse]);
    await expect(
      runRole(id, input(id), context(runtime)),
    ).rejects.toBeInstanceOf(RoleOutputError);
    expect(runtime.faux.state.callCount).toBe(2);
  });
  it("ends an unresolved tool loop at the configured turn limit", async () => {
    const loop = () =>
      fauxAssistantMessage(fauxToolCall("unavailable_tool", {}), {
        stopReason: "toolUse",
      });
    const runtime = createFauxRuntime([loop(), loop(), loop()]);
    await expect(
      runRole(id, input(id), { ...context(runtime), maxTurns: 2 }),
    ).rejects.toBeInstanceOf(RoleTurnLimitError);
    expect(runtime.faux.state.callCount).toBe(2);
  });
});

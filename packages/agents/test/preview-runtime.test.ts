import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxToolCall,
  normalizeContext,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { state } from "@ruwen/core";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  assertRealChargingAllowed,
  releasePolicy,
  runtimeSettings,
} from "../../../config/settings.ts";
import {
  CANDIDATE,
  makeApproval,
  preparePacket,
  scope,
  temporaryProject,
} from "../../core/test/helpers.ts";
import {
  createApplicationRuntime,
  createFauxRuntime,
  type Data,
  FAUX_SCENARIOS,
  PREVIEW_PROSE,
  ROLE_IDS,
  RoleOutputError,
  RoleSecurityError,
  RoleTruncatedError,
  runRole,
} from "../src/index.ts";
import { stableRequestHash } from "../src/runtime/tapes.ts";
import { deploymentCanary } from "../src/security/notes.ts";

let project: Awaited<ReturnType<typeof temporaryProject>>;
let packet: string;
let workspace: string;
beforeAll(async () => {
  project = await temporaryProject();
  packet = await project.fs.readText(await preparePacket(project.fs));
  await project.fs.write(CANDIDATE, PREVIEW_PROSE);
  await state.recordApproved(
    project.fs,
    CANDIDATE,
    "preview",
    await makeApproval(
      project.fs,
      CANDIDATE,
      "candidate_approve",
      "preview-runtime",
    ),
  );
  await state.promoteApproved(project.fs, "chapters/001.md");
  workspace = await mkdtemp(path.join(tmpdir(), "ruwen-tapes-"));
});
afterAll(async () => {
  await project?.cleanup();
  if (workspace) await rm(workspace, { recursive: true, force: true });
});
const input = (): Data => ({
  packet,
  prose: PREVIEW_PROSE,
  approved_prose: PREVIEW_PROSE,
  chapter: "001",
  reading: { reactions: [] },
  scope: scope(),
  resources: [],
  approved_resources: [],
  brief: { creative_value: "人物当前的开放处境" },
  locked_events: ["粮车先离开"],
  locked_order: [],
  hard_rules: [{ id: "xiaoyan-yingsheding", content: "凭证不能调兵" }],
});
const runtime = (scenario: string) =>
  createApplicationRuntime({
    mode: "faux",
    workspaceRoot: workspace,
    scenario,
    initialDelayMs: 0,
    characterDelayMs: 0,
  });
it("preview prose contains 3000–5000 Chinese characters and default calibration is explicit", () => {
  const han = PREVIEW_PROSE.match(/\p{Script=Han}/gu)?.length ?? 0;
  expect(han).toBeGreaterThanOrEqual(3000);
  expect(han).toBeLessThanOrEqual(5000);
  expect(runtimeSettings().calibration.label).toBe("待 P3 实测");
});
it.each(
  ROLE_IDS,
)("realistic normal script for %s obeys its existing output contract", async (id) => {
  const data =
    id === "chuangyi-xietiaoyuan"
      ? {
          raw_user_text: "我想继续讨论人物的处境与故事方向。",
          project_state: { project: "test-project" },
        }
      : input();
  const result = await runRole(id, data, {
    fs: project.fs,
    projectKey: "test-project",
    runtime: runtime("normal"),
  });
  expect(result.runtimeMode).toBe("faux");
  expect(result.output).toBeTruthy();
});
it.each(
  FAUX_SCENARIOS.filter((name) => name !== "normal"),
)("scenario %s exercises a real validation boundary", async (scenario) => {
  const id =
    scenario === "length"
      ? "xiaoshuo-zuozhe"
      : scenario === "plot_fail"
        ? "qingjie-heyanyuan"
        : scenario === "reality_fail"
          ? "xianshi-heyanyuan"
          : scenario === "missing_submit"
            ? "qinggan-duzhe"
            : "wenxue-bianji";
  const task = runRole(id, input(), {
    fs: project.fs,
    projectKey: "test-project",
    runtime: runtime(scenario),
  });
  if (["anchor_ambiguous", "anchor_missing", "edit_ratio"].includes(scenario))
    await expect(task).rejects.toBeInstanceOf(RoleOutputError);
  else if (scenario === "length")
    await expect(task).rejects.toBeInstanceOf(RoleTruncatedError);
  else {
    const result = await task;
    if (scenario === "missing_submit") expect(result.usage).toHaveLength(2);
    else if (typeof result.output === "object")
      expect(
        scenario === "restage" ? result.output.decision : result.output.pass,
      ).toBe(scenario === "restage" ? "RESTAGE" : false);
  }
});
it("records complete responses and usage locally then replays offline; a changed request fails closed", async () => {
  const upstream = createFauxRuntime([
    fauxAssistantMessage("候选正文。\n第二段。"),
  ]);
  const record = createApplicationRuntime({
    mode: "record",
    workspaceRoot: workspace,
    upstream,
  });
  const first = await runRole(
    "xiaoshuo-zuozhe",
    { packet: "测试资料包" },
    { fs: project.fs, projectKey: "test-project", runtime: record },
  );
  const files = await readdir(path.join(workspace, ".local/model-recordings"));
  expect(files).toHaveLength(1);
  const file = JSON.parse(
    await readFile(
      path.join(workspace, ".local/model-recordings", String(files[0])),
      "utf8",
    ),
  );
  expect(file.request.context.messages).toHaveLength(2);
  expect(file.version).toBe(3);
  expect(JSON.stringify(file)).not.toContain(process.env.RUWEN_CANARY);
  expect(file.request.context.messages[0]).toHaveProperty("prompt_sha256");
  expect(file.response.usage).toEqual(first.usage[0]);
  const offline = createFauxRuntime([]);
  const replay = createApplicationRuntime({
    mode: "replay",
    workspaceRoot: workspace,
    upstream: offline,
  });
  const deltas: string[] = [];
  const second = await runRole(
    "xiaoshuo-zuozhe",
    { packet: "测试资料包" },
    {
      fs: project.fs,
      projectKey: "test-project",
      runtime: replay,
      onDelta: (delta) => deltas.push(delta),
    },
  );
  expect(second.output).toBe(first.output);
  expect(second.usage).toEqual(first.usage);
  expect(deltas.join("")).toBe(second.output);
  await expect(
    runRole(
      "xiaoshuo-zuozhe",
      { packet: "已改变资料包" },
      { fs: project.fs, projectKey: "test-project", runtime: replay },
    ),
  ).rejects.toThrow();
  expect(offline.faux.state.callCount).toBe(0);
});
it("a blocked record never saves the canary or full system message, and recording inside a user project is refused", async () => {
  const filesBefore = new Set(
    await readdir(path.join(workspace, ".local/model-recordings")),
  );
  const record = createApplicationRuntime({
    mode: "record",
    workspaceRoot: workspace,
    upstream: createFauxRuntime([fauxAssistantMessage(deploymentCanary())]),
  });
  await expect(
    runRole(
      "xiaoshuo-zuozhe",
      { packet: "独立的安全录制测试" },
      {
        fs: project.fs,
        projectKey: "test-project",
        runtime: record,
      },
    ),
  ).rejects.toBeInstanceOf(RoleSecurityError);
  const added = (
    await readdir(path.join(workspace, ".local/model-recordings"))
  ).filter((file) => !filesBefore.has(file));
  expect(added).toHaveLength(1);
  const body = await readFile(
    path.join(workspace, ".local/model-recordings", added[0] ?? ""),
    "utf8",
  );
  expect(body).not.toContain(deploymentCanary());
  expect(JSON.parse(body).request.context.messages[0]).not.toHaveProperty(
    "content",
  );
  const upstream = createFauxRuntime([]);
  const unsafe = createApplicationRuntime({
    mode: "record",
    workspaceRoot: project.fs.root,
    upstream,
  });
  await expect(
    runRole(
      "xiaoshuo-zuozhe",
      { packet: "测试" },
      { fs: project.fs, projectKey: "test-project", runtime: unsafe },
    ),
  ).rejects.toThrow("outside the user project");
  expect(upstream.faux.state.callCount).toBe(0);
});
it("stable request hashes ignore random tool IDs and timestamps, preserve argument IDs, and exclude credentials", () => {
  const model = { id: "m", provider: "p", api: "a" };
  const context = (
    id: string,
    timestamp: number,
    argument = "resource-1",
  ): TranscriptContext =>
    normalizeContext({
      messages: [
        fauxAssistantMessage(
          fauxToolCall("read_resource", { id: argument }, { id }),
          { timestamp },
        ),
      ],
    });
  expect(
    stableRequestHash(model, context("a", 10), {
      apiKey: "secret-1",
      sessionId: "one",
    }),
  ).toBe(
    stableRequestHash(model, context("b", 20), {
      apiKey: "secret-2",
      sessionId: "two",
    }),
  );
  expect(stableRequestHash(model, context("a", 10, "resource-2"))).not.toBe(
    stableRequestHash(model, context("a", 10)),
  );
});
it("recording excludes credentials even when an upstream error echoes one, and replay preserves the failure", async () => {
  const secret = "FAKE_TEST_KEY_NEVER_RECORD_418";
  const upstream = createFauxRuntime([
    fauxAssistantMessage("", {
      stopReason: "error",
      errorMessage: `upstream rejected ${secret}`,
    }),
  ]);
  upstream.apiKey = () => secret;
  const folder = path.join(workspace, "error-case");
  const record = createApplicationRuntime({
    mode: "record",
    workspaceRoot: folder,
    upstream,
  });
  await expect(
    runRole(
      "xiaoshuo-zuozhe",
      { packet: "错误录制资料包" },
      { fs: project.fs, projectKey: "test-project", runtime: record },
    ),
  ).rejects.toThrow("[REDACTED]");
  const file = (await readdir(path.join(folder, ".local/model-recordings")))[0];
  const content = await readFile(
    path.join(folder, ".local/model-recordings", String(file)),
    "utf8",
  );
  expect(content).not.toContain(secret);
  expect(content).not.toContain('"apiKey"');
  const replay = createApplicationRuntime({
    mode: "replay",
    workspaceRoot: folder,
    upstream: createFauxRuntime([]),
  });
  await expect(
    runRole(
      "xiaoshuo-zuozhe",
      { packet: "错误录制资料包" },
      { fs: project.fs, projectKey: "test-project", runtime: replay },
    ),
  ).rejects.toThrow("[REDACTED]");
});
it("production invitation and charging guards fail closed even if only one flag is enabled", () => {
  expect(
    releasePolicy({
      NODE_ENV: "production",
      INVITE_ONLY: "0",
      REAL_CHARGING_ENABLED: "1",
    }),
  ).toMatchObject({ inviteOnly: true, realChargingEnabled: false });
  expect(() => assertRealChargingAllowed({ P3_GATE_PASSED: "1" })).toThrow();
  expect(() =>
    assertRealChargingAllowed({ REAL_CHARGING_ENABLED: "1" }),
  ).toThrow();
  expect(
    releasePolicy({ P3_GATE_PASSED: "1", REAL_CHARGING_ENABLED: "1" })
      .realChargingEnabled,
  ).toBe(true);
});

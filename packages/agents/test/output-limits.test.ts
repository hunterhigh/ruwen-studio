import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { state } from "@ruwen/core";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  CANDIDATE,
  makeApproval,
  preparePacket,
  temporaryProject,
} from "../../core/test/helpers.ts";
import {
  createFauxRuntime,
  type Data,
  FAUX_PROSE,
  ROLE_IDS,
  ROLES,
  RoleOutputError,
  RoleTruncatedError,
  resolveRoute,
  roleGenerationPolicy,
  runRole,
} from "../src/index.ts";

let p: Awaited<ReturnType<typeof temporaryProject>>;
beforeAll(async () => {
  p = await temporaryProject();
  await preparePacket(p.fs);
  await p.fs.write(CANDIDATE, FAUX_PROSE);
  await state.recordApproved(
    p.fs,
    CANDIDATE,
    "v1",
    await makeApproval(p.fs, CANDIDATE, "candidate_approve", "output-limits"),
  );
  await state.promoteApproved(p.fs, "chapters/001.md");
});
afterAll(async () => p?.cleanup());
it("all role budgets have a basis and fit the installed catalog, including thinking headroom", () => {
  const models = anthropicProvider().getModels();
  for (const id of ROLE_IDS) {
    const policy = roleGenerationPolicy(id),
      route = resolveRoute(ROLES[id]);
    const model = models.find((m) => m.id === route.modelId);
    expect(policy.basis.length).toBeGreaterThan(5);
    expect(policy.maxTokens).toBeLessThanOrEqual(model?.maxTokens ?? 0);
    if (["xiaoshuo-zuozhe", "wenxue-bianji"].includes(id)) {
      expect(policy.maxTokens).toBeGreaterThanOrEqual(32768);
      expect(model?.compat?.forceAdaptiveThinking).toBe(true);
    }
  }
});
it.each([
  "xiaoshuo-zuozhe",
  "qinggan-duzhe",
] as const)("faux length in %s never retries or accepts even a complete tool call; usage survives", async (id) => {
  const response =
    id === "xiaoshuo-zuozhe"
      ? FAUX_PROSE
      : fauxToolCall("submit_reading", { reactions: [] });
  let cap: number | undefined;
  const runtime = createFauxRuntime([
    (ctx, options) => {
      expect(ctx.messages).toHaveLength(2);
      cap = options?.maxTokens;
      return fauxAssistantMessage(response, { stopReason: "length" });
    },
  ]);
  const failure = await runRole(
    id,
    { packet: "测试作者资料包", prose: FAUX_PROSE },
    { fs: p.fs, projectKey: "test-project", runtime },
  ).catch((e: unknown) => e);
  expect(failure).toBeInstanceOf(RoleTruncatedError);
  if (!(failure instanceof RoleTruncatedError))
    throw new Error("Missing failure");
  expect(runtime.faux.state.callCount).toBe(1);
  expect(cap).toBe(roleGenerationPolicy(id).maxTokens);
  expect(failure.partial?.usage).toHaveLength(1);
  expect(failure.partial?.usage[0]?.output).toBeGreaterThan(0);
  expect(failure.partial?.output).toBe("");
});
it.each([
  ["not unique", { original: "甲" }],
  ["not found", { original: "不存在" }],
  ["proportion", { replacement: "字".repeat(80) }],
] as const)("faux editor rejects %s", async (message, override) => {
  const payload = {
    decision: "LOCAL_EDIT",
    edits: [
      {
        original: "旧",
        replacement: "新",
        kind: "literary",
        reason: "节奏",
        ...override,
      },
    ],
    problems: [],
  };
  const response = () =>
    fauxAssistantMessage(fauxToolCall("submit_edit", payload), {
      stopReason: "toolUse",
    });
  const runtime = createFauxRuntime([response, response]);
  await expect(
    runRole(
      "wenxue-bianji",
      { prose: `左旧右${"甲".repeat(200)}`, reading: { reactions: [] } },
      { fs: p.fs, projectKey: "test-project", runtime },
    ),
  ).rejects.toThrow(message);
  expect(runtime.faux.state.callCount).toBe(2);
});
it("faux memory rejects a nonexistent section after authorized read, without writing canon", async () => {
  const hash = await p.fs.sha256("世界/当前态势.md");
  const output: Data = {
    new_facts: [],
    state_changes: [],
    invalidated: [],
    scope_changes: [],
    next_chapter_state: "待确认",
    patches: [
      {
        path: "世界/当前态势.md",
        base_sha256: hash,
        sections: [{ heading: "## 不存在", replacement: "无效补丁" }],
      },
    ],
  };
  const response = () =>
    fauxAssistantMessage(fauxToolCall("submit_memory_preview", output), {
      stopReason: "toolUse",
    });
  const runtime = createFauxRuntime([
    fauxAssistantMessage(
      fauxToolCall("read_resource", { id: "shijie-dangqian-taishi" }),
      { stopReason: "toolUse" },
    ),
    response,
    response,
  ]);
  await expect(
    runRole(
      "jiyi-weihuyuan",
      { approved_prose: FAUX_PROSE, resources: [] },
      { fs: p.fs, projectKey: "test-project", runtime },
    ),
  ).rejects.toThrow("Section does not exist");
  expect(runtime.faux.state.callCount).toBe(3);
  expect(await p.fs.sha256("世界/当前态势.md")).toBe(hash);
});
it("deprecated whole chapter and whole file model formats are rejected by schema", async () => {
  const response = () =>
    fauxAssistantMessage(
      fauxToolCall("submit_edit", {
        decision: "LOCAL_EDIT",
        edits: [],
        problems: [],
        edited_text: FAUX_PROSE,
      }),
      { stopReason: "toolUse" },
    );
  await expect(
    runRole(
      "wenxue-bianji",
      { prose: FAUX_PROSE },
      {
        fs: p.fs,
        projectKey: "test-project",
        runtime: createFauxRuntime([response, response]),
      },
    ),
  ).rejects.toBeInstanceOf(RoleOutputError);
  const memory = () =>
    fauxAssistantMessage(
      fauxToolCall("submit_memory_preview", {
        new_facts: [],
        state_changes: [],
        invalidated: [],
        scope_changes: [],
        next_chapter_state: "待确认",
        patches: [
          {
            path: "世界/当前态势.md",
            base_sha256: "a".repeat(64),
            new_content: "整个文件",
          },
        ],
      }),
      { stopReason: "toolUse" },
    );
  await expect(
    runRole(
      "jiyi-weihuyuan",
      { approved_prose: FAUX_PROSE, resources: [] },
      {
        fs: p.fs,
        projectKey: "test-project",
        runtime: createFauxRuntime([memory, memory]),
      },
    ),
  ).rejects.toBeInstanceOf(RoleOutputError);
});
it("author and editor runtime overrides cannot silently lower the minimum 32k output allowance", async () => {
  const runtime = createFauxRuntime();
  for (const id of ["xiaoshuo-zuozhe", "wenxue-bianji"] as const)
    await expect(
      runRole(
        id,
        { packet: "作者资料包", prose: FAUX_PROSE },
        { fs: p.fs, projectKey: "test-project", runtime, maxTokens: 8000 },
      ),
    ).rejects.toBeInstanceOf(RoleOutputError);
  expect(runtime.faux.state.callCount).toBe(0);
});

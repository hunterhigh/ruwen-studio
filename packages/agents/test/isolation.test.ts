import {
  fauxAssistantMessage,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { candidateProblems, registry } from "@ruwen/core";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  preparePacket,
  temporaryProject,
  updateResource,
} from "../../core/test/helpers.ts";
import {
  createFauxRuntime,
  FAUX_PROSE,
  RoleAbortError,
  type RoleContext,
  RoleTimeoutError,
  readAuthorizedResource,
  roleTools,
  runRole,
  TavilySearchProvider,
} from "../src/index.ts";

let project: Awaited<ReturnType<typeof temporaryProject>>;
let packet: string;
beforeAll(async () => {
  project = await temporaryProject();
  const fs = project.fs;
  packet = await fs.readText(await preparePacket(fs));
  await updateResource(
    fs,
    "gushi-dangqian-hu",
    "# 当前故事弧\n\nOUTLINE_SECRET_483\n",
  );
  await fs.write("研究/隔离哨兵.md", "RESEARCH_SECRET_984");
  await fs.write("治理/隔离哨兵.md", "GOVERNANCE_SECRET_652");
});
afterAll(async () => {
  await project.cleanup();
});
const ctx = (): RoleContext => ({
  fs: project.fs,
  projectKey: "test-project",
  runtime: createFauxRuntime(),
});
it("inv-ledger-separation: governance sees only category counts via its summary tool, never private problem fields", async () => {
  for (const [index, chapter] of ["001", "002", "002"].entries())
    await candidateProblems.record(
      project.fs,
      {
        projectId: "test-project",
        chapter,
        runId: `run-${index}`,
        status: "pending",
      },
      [
        {
          location: "PRIVATE_LOCATION_681",
          category: "explanation",
          condition: "PRIVATE_CONDITION_682",
          handling: "PRIVATE_HANDLING_683",
          result: "PRIVATE_RESULT_684",
        },
      ],
    );
  const requests: TranscriptContext[] = [];
  const runtime = createFauxRuntime([
    fauxAssistantMessage(fauxToolCall("read_problem_summary", {}), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(
      fauxToolCall("submit_governance_preview", {
        changes: [],
        conflicts: [],
        scope_changes: [],
        writes_requested: [],
        patches: [],
      }),
      { stopReason: "toolUse" },
    ),
  ]);
  await runRole(
    "xiangmu-zhiliyuan",
    {
      brief: { creative_value: "检查项目治理" },
      resource_ids: [],
      scope: { project: "test-project" },
    },
    { ...ctx(), runtime, onRequest: (request) => requests.push(request) },
  );
  const request = JSON.stringify(requests[1]);
  expect(request).toContain("recurrence_candidate");
  expect(request).toContain("explanation");
  for (const sentinel of [
    "PRIVATE_LOCATION_681",
    "PRIVATE_CONDITION_682",
    "PRIVATE_HANDLING_683",
    "PRIVATE_RESULT_684",
  ])
    expect(request).not.toContain(sentinel);
  const summary = await roleTools("xiangmu-zhiliyuan", ctx())
    .find((tool) => tool.name === "read_problem_summary")
    ?.execute("summary", {});
  expect(summary?.details).toEqual({
    total: 3,
    categories: [
      {
        category: "explanation",
        count: 3,
        task_count: 2,
        recurrence_candidate: true,
      },
    ],
  });
  for (const role of [
    "xiaoshuo-zuozhe",
    "qinggan-duzhe",
    "wenxue-bianji",
    "jiyi-weihuyuan",
  ] as const)
    expect(roleTools(role, ctx()).map((tool) => tool.name)).not.toContain(
      "read_problem_summary",
    );
});
it("inv-author-isolation / inv-reader-isolation: captured complete requests contain no private source or later opinion", async () => {
  const requests: TranscriptContext[] = [];
  const common = {
    outline: "OUTLINE_SECRET_483",
    research: "RESEARCH_SECRET_984",
    governance: "GOVERNANCE_SECRET_652",
    editor_opinion: "EDITOR_SECRET_211",
    sources: ["SOURCE_SECRET_332"],
  };
  await runRole(
    "xiaoshuo-zuozhe",
    { packet, ...common },
    { ...ctx(), onRequest: (r) => requests.push(r) },
  );
  await runRole(
    "qinggan-duzhe",
    {
      prose: FAUX_PROSE,
      chapter: "001",
      previous_tail: "尾".repeat(800),
      ...common,
    },
    { ...ctx(), onRequest: (r) => requests.push(r) },
  );
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    const data = JSON.stringify(request);
    expect(data).not.toMatch(
      /(?:OUTLINE|RESEARCH|GOVERNANCE|EDITOR|SOURCE)_SECRET/,
    );
    expect(data).not.toContain("read_resource");
  }
  expect(JSON.stringify(requests[1])).not.toContain("项目声音");
});
it("inv-fresh-context: independent runs never replay history and raw/translated inputs cannot mix", async () => {
  const requests: TranscriptContext[] = [];
  const context = {
    ...ctx(),
    onRequest: (r: TranscriptContext) => requests.push(r),
  };
  await runRole("qinggan-duzhe", { prose: "第一段独有哨兵。" }, context);
  await runRole("qinggan-duzhe", { prose: "第二段独有哨兵。" }, context);
  expect(JSON.stringify(requests[1])).not.toContain("第一段独有哨兵");
  await expect(
    runRole("gushi-gousishi", { brief: {}, raw_user_text: "原话" }, ctx()),
  ).rejects.toThrow("Raw user");
  await expect(
    runRole(
      "chuangyi-xietiaoyuan",
      { raw_user_text: "原话", brief: {} },
      ctx(),
    ),
  ).rejects.toThrow("translated");
});
it("inv-readers-whitelist / project scope: no guessing IDs, paths, or foreign resources", async () => {
  const context = ctx();
  const data = await registry.readRegistry(project.fs);
  const resource = data.resources.find(
    (r) => r.status === "active" && r.readers.includes("jiyi-weihuyuan"),
  );
  if (!resource) throw new Error("Missing fixture resource");
  expect(
    (await readAuthorizedResource(context, "jiyi-weihuyuan", resource.id)).path,
  ).toBe(resource.path);
  await expect(
    readAuthorizedResource(
      { ...context, projectKey: "foreign" },
      "jiyi-weihuyuan",
      resource.id,
    ),
  ).rejects.toThrow("无权");
  await expect(
    readAuthorizedResource(context, "xiaoshuo-zuozhe", resource.id),
  ).rejects.toThrow("固定输入");
  await expect(
    readAuthorizedResource(context, "qinggan-duzhe", resource.id),
  ).rejects.toThrow("固定输入");
  await expect(
    readAuthorizedResource(context, "jiyi-weihuyuan", "../../private"),
  ).rejects.toThrow("无权");
  const forbidden = data.resources.find(
    (r) => r.status === "active" && !r.readers.includes("jiyi-weihuyuan"),
  );
  if (!forbidden) throw new Error("Missing unreadable fixture resource");
  await expect(
    readAuthorizedResource(context, "jiyi-weihuyuan", forbidden.id),
  ).rejects.toThrow("无权");
  const bytes = await project.fs.read(resource.path);
  await project.fs.write(resource.path, "tampered");
  await expect(
    readAuthorizedResource(context, "jiyi-weihuyuan", resource.id),
  ).rejects.toThrow();
  await project.fs.write(resource.path, bytes);
});
it("only approved consultant research gets a bounded search tool; editor gets at most two diagnostics", async () => {
  const context = ctx();
  let count = 0;
  const search = {
    search: async () => {
      count++;
      return [];
    },
  };
  expect(
    roleTools("waibu-zhishi-guwen", { ...context, search }).some(
      (t) => t.name === "web_search",
    ),
  ).toBe(false);
  const tool = roleTools("waibu-zhishi-guwen", {
    ...context,
    search,
    searchApproved: true,
  }).find((t) => t.name === "web_search");
  if (!tool) throw new Error("Search missing");
  for (let i = 0; i < 3; i++)
    await tool.execute("search", { query: "已批准问题" });
  await expect(tool.execute("search", { query: "超额" })).rejects.toThrow(
    "上限",
  );
  expect(count).toBe(3);
  const diag = roleTools("wenxue-bianji", context)[0];
  if (!diag) throw new Error("Diagnostic missing");
  await expect(diag.execute("d", { name: "../../secret" })).rejects.toThrow(
    "未知",
  );
  await diag.execute("d", { name: "explanation" });
  await diag.execute("d", { name: "face-and-affect" });
  await expect(diag.execute("d", { name: "explanation" })).rejects.toThrow(
    "最多",
  );
});
it("submit terminates a mixed tool batch before any subsequent resource read", async () => {
  const runtime = createFauxRuntime([
    fauxAssistantMessage(
      [
        fauxToolCall("submit_reading", { reactions: [] }),
        fauxToolCall("read_resource", { id: "private" }),
      ],
      { stopReason: "toolUse" },
    ),
  ]);
  const result = await runRole(
    "qinggan-duzhe",
    { prose: FAUX_PROSE },
    { ...ctx(), runtime },
  );
  expect(result.output).toEqual({ reactions: [] });
  expect(runtime.faux.state.callCount).toBe(1);
  expect(JSON.stringify(result.transcript)).not.toContain("OUTLINE_SECRET_483");
});
it("abort and timeout preserve partial usage and stop without retries", async () => {
  for (const timeout of [false, true]) {
    const controller = new AbortController();
    const runtime = createFauxRuntime([
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return fauxAssistantMessage(FAUX_PROSE);
      },
    ]);
    const timer = timeout
      ? undefined
      : setTimeout(() => controller.abort(), 20);
    try {
      await expect(
        runRole(
          "xiaoshuo-zuozhe",
          { packet },
          {
            ...ctx(),
            runtime,
            signal: controller.signal,
            timeoutMs: timeout ? 20 : 1000,
          },
        ),
      ).rejects.toBeInstanceOf(timeout ? RoleTimeoutError : RoleAbortError);
    } finally {
      clearTimeout(timer);
    }
    expect(runtime.faux.state.callCount).toBeLessThanOrEqual(1);
  }
});
it("search adapter uses the documented endpoint, never returns raw pages or unsafe URLs", async () => {
  let request: RequestInit | undefined;
  const provider = new TavilySearchProvider("test-key", async (url, init) => {
    expect(String(url)).toBe("https://api.tavily.com/search");
    request = init;
    return new Response(
      JSON.stringify({
        results: [
          { title: "source", url: "https://example.com", content: "证据" },
          { url: "file:///secret", content: "private" },
        ],
      }),
      { status: 200 },
    );
  });
  await expect(provider.search("query")).rejects.toThrow(
    "Invalid search result",
  );
  expect(request?.method).toBe("POST");
  expect(request?.body).not.toContain("test-key");
});
it("provider errors cannot persist an API key in a partial transcript", async () => {
  const secret = "local-test-secret-4849";
  const runtime = createFauxRuntime([
    () => {
      throw new Error(`provider error ${secret}`);
    },
  ]);
  runtime.apiKey = () => secret;
  try {
    await runRole("xiaoshuo-zuozhe", { packet }, { ...ctx(), runtime });
    throw new Error("Expected provider failure");
  } catch (error) {
    expect(String(error)).not.toContain(secret);
    expect(JSON.stringify(error)).not.toContain(secret);
    expect(String(error)).toContain("[REDACTED]");
  }
});

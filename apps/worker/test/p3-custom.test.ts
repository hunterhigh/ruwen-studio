import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFauxRuntime } from "@ruwen/agents";
import { afterEach, expect, inject, it, vi } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import {
  importProjectZip,
  LocalDirFS,
  registry,
} from "../../../packages/core/src/index.ts";
import { runP3Smoke, smokeFaux } from "../../../scripts/lib/p3-smoke.ts";
import { formatSmokePlan, smokePlan } from "../../../scripts/lib/smoke-plan.ts";

const roots: string[] = [];
async function folder() {
  const root = await mkdtemp(path.join(tmpdir(), "ruwen-custom-smoke-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("ruwen-custom-smoke-")
    )
      throw new Error("Unsafe cleanup");
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});
const brief =
  "这是属于本次协调员会话的独特原话哨兵，不能出现在下游的任何请求、预览或录制明文里面。希望写一段人物再次会面的故事，关系尚未得到明确答复。";

it("custom input stays coordinator-only, approved story reaches compiler, and isolated record/replay completes", async () => {
  const directory = await folder(),
    upstream = smokeFaux(true),
    original = upstream.models.streamSimple.bind(upstream.models);
  let coordinatorSawSource = false,
    compilerSawStory = false;
  upstream.models.streamSimple = ((model, context, options) => {
    const role = requestRole(context as Parameters<typeof requestRole>[0]);
    const material = JSON.stringify(
      context.messages.filter((m) => m.role !== "system"),
    );
    if (role === "chuangyi-xietiaoyuan")
      coordinatorSawSource ||= material.includes(brief);
    else expect(material).not.toContain(brief.slice(0, 40));
    if (role === "zhangjie-qingjing-bianyiyuan")
      compilerSawStory ||= material.includes("身份变化使靠近成为现实的可能");
    return original(model, context, options);
  }) as typeof original;
  const record = await runP3Smoke({
    url: inject("databaseUrl"),
    directory,
    mode: "record",
    brief,
    upstream,
  });
  expect(record.status, record.failure ?? "").toBe("completed");
  expect(coordinatorSawSource).toBe(true);
  expect(compilerSawStory).toBe(true);
  expect(record.scenario).toBe("custom");
  expect(record.candidate).not.toContain("粮车");
  expect(record.steps.at(-1)?.status).toBe("AWAITING_MEMORY_APPROVAL");
  expect(record.briefSha256).toBe(
    createHash("sha256").update(brief).digest("hex"),
  );
  expect(JSON.stringify(record)).not.toContain(brief.slice(0, 40));
  const destination = await folder(),
    fs = new LocalDirFS(destination);
  await importProjectZip(
    fs,
    await readFile(path.join(directory, "custom-bootstrap.zip")),
  );
  for (const p of [
    "人物/主角档案.md",
    "世界/世界总表.md",
    "故事/当前故事弧.md",
    "表现/项目声音.md",
    "authoring-ruwen-v5/projections/current.md",
    "治理/激活证据/demo-biaoxian-xiangmu-shengyin-trial.md",
  ])
    expect(await fs.readText(p)).not.toMatch(/粮车|林川|送信人|驿站/);
  expect((await registry.validateRegistry(fs)).errors).toEqual([]);
  const offline = smokeFaux(true);
  offline.models.streamSimple = () => {
    throw new Error("No replay fallback");
  };
  const replay = await runP3Smoke({
    url: inject("databaseUrl"),
    directory,
    mode: "replay",
    brief,
    upstream: offline,
  });
  expect(replay.status, replay.failure ?? "").toBe("completed");
  expect(replay.candidate).toBe(record.candidate);
  await expect(
    runP3Smoke({
      url: inject("databaseUrl"),
      directory,
      mode: "replay",
      brief: `${brief}改了`,
      upstream: offline,
    }),
  ).rejects.toThrow("SAME --brief-file");
}, 60000);

it("custom planning uses actual input bytes with zero provider/fetch calls and leaves no recording", async () => {
  vi.stubEnv("MODEL_PROFILE", "deepseek");
  const directory = await folder(),
    fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("No network in plan");
    });
  try {
    const report = await runP3Smoke({
      url: inject("databaseUrl"),
      directory,
      mode: "record",
      brief,
      planOnly: true,
      maxUsd: 1.2,
    });
    expect(report.status, report.failure ?? "").toBe("completed");
    expect(report.providerCalls).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(smokePlan(report).canFinish).toBe(true);
    expect(formatSmokePlan(smokePlan(report))).toContain(
      "custom input, local illustrative replies",
    );
    expect(await readdir(directory)).toEqual([]);
  } finally {
    fetch.mockRestore();
  }
}, 30000);

it("custom input fails closed on an empty story preview instead of compiling unrelated fixture material", async () => {
  const upstream = smokeFaux(true),
    empty = createFauxRuntime([defaultFauxResponse]),
    original = upstream.models.streamSimple.bind(upstream.models);
  upstream.models.streamSimple = ((model, context, options) =>
    requestRole(context as Parameters<typeof requestRole>[0]) ===
    "gushi-gousishi"
      ? empty.models.streamSimple(model, context, options)
      : original(model, context, options)) as typeof original;
  const report = await runP3Smoke({
    url: inject("databaseUrl"),
    directory: await folder(),
    mode: "record",
    brief,
    upstream,
  });
  expect(report.failure).toContain("CUSTOM_STORY_PREVIEW_EMPTY");
  expect(
    report.calls.some(
      (c) =>
        c.role === "zhangjie-qingjing-bianyiyuan" ||
        c.role === "xiaoshuo-zuozhe",
    ),
  ).toBe(false);
}, 30000);

it.each([
  "",
  "  ",
  "字".repeat(12001),
])("rejects invalid custom input before creating a model runtime", async (brief) => {
  await expect(
    runP3Smoke({
      url: inject("databaseUrl"),
      directory: await folder(),
      mode: "record",
      brief,
    }),
  ).rejects.toThrow("1–12000");
});

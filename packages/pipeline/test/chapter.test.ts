import {
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  createFauxRuntime,
  type Data,
  FAUX_PROSE,
  ROLES,
  type RoleId,
} from "@ruwen/agents";
import { state } from "@ruwen/core";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFauxResponse, requestRole } from "../../agents/src/faux.ts";
import {
  PROJECTION,
  preparePacket,
  temporaryProject,
} from "../../core/test/helpers.ts";
import {
  approveCandidate,
  approveMemory,
  cancelRun,
  loadRun,
  type PipelineContext,
  returnCandidate,
  startChapter,
} from "../src/index.ts";

function required(value: string | undefined): string {
  if (!value) throw new Error("Expected run artifact");
  return value;
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function setup(
  override?: (
    id: RoleId,
    context: TranscriptContext,
  ) => Data | string | undefined,
) {
  const project = await temporaryProject();
  cleanups.push(project.cleanup);
  await preparePacket(project.fs);
  const responses: FauxResponseStep[] = Array.from(
    { length: 100 },
    () => (context) => {
      const id = requestRole(context);
      const value = override?.(id, context);
      if (value === undefined) return defaultFauxResponse(context);
      const spec = ROLES[id];
      return spec.output.kind === "text"
        ? fauxAssistantMessage(String(value))
        : fauxAssistantMessage(
            fauxToolCall(spec.output.toolName, value as Data),
            { stopReason: "toolUse" },
          );
    },
  );
  const ctx: PipelineContext = {
    projectKey: "test-project",
    runtime: createFauxRuntime(responses),
  };
  return { ...project, ctx };
}
const approve = (
  p: Awaited<ReturnType<typeof setup>>,
  run: Awaited<ReturnType<typeof startChapter>>,
) =>
  approveCandidate(
    p.fs,
    run.id,
    { confirmed: true, expectedSha256: required(run.candidateSha256) },
    p.ctx,
  );
describe("chapter pipeline", { timeout: 20000 }, () => {
  it("inv-candidate-not-canon / inv-editor-original / two independent approvals", async () => {
    const p = await setup();
    const before = await p.fs.sha256("世界/当前态势.md");
    let run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    expect(run.status).toBe("AWAITING_CANDIDATE_APPROVAL");
    expect(await p.fs.exists(run.target)).toBe(false);
    expect(await p.fs.readText(required(run.paths.original))).toBe(FAUX_PROSE);
    expect(await p.fs.sha256("世界/当前态势.md")).toBe(before);
    run = await approve(p, run);
    expect(run.status, run.error).toBe("AWAITING_MEMORY_APPROVAL");
    expect(await p.fs.readText(run.target)).toBe(FAUX_PROSE);
    expect(await p.fs.sha256("世界/当前态势.md")).toBe(before);
    run = await approveMemory(
      p.fs,
      run.id,
      { confirmed: true, expectedSha256: required(run.memoryPreviewSha256) },
      p.ctx,
    );
    expect(run.status).toBe("DONE");
    expect(await p.fs.sha256("世界/当前态势.md")).not.toBe(before);
    expect((await state.loadState(p.fs)).pending_consolidation).toBe(false);
    await expect(
      approveMemory(
        p.fs,
        run.id,
        { confirmed: true, expectedSha256: required(run.memoryPreviewSha256) },
        p.ctx,
      ),
    ).rejects.toThrow("not awaiting");
  });
  it.each([
    "RESTAGE",
    "RETURN_CONSTRUCTION",
  ])("editor %s returns unchanged prose", async (decision) => {
    const p = await setup((id) =>
      id === "wenxue-bianji"
        ? { decision, changes: [], return_reason: "需要重新处理场景压力。" }
        : undefined,
    );
    const run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    expect(run.status).toBe("RETURNED");
    expect(run.returnedTo).toBe(decision === "RESTAGE" ? "author" : "ideation");
    expect(await p.fs.readText(required(run.paths.original))).toBe(FAUX_PROSE);
    expect(run.roles["qingjie-heyanyuan"]).toBeUndefined();
    expect(await p.fs.exists(run.target)).toBe(false);
  });
  it("records fact and literary edits separately and preserves original before invoking editor", async () => {
    let originalAtEditor = "";
    const p = await setup((id) =>
      id === "wenxue-bianji"
        ? {
            decision: "LOCAL_EDIT",
            edited_text: `${FAUX_PROSE}他把信封收得更紧。`,
            changes: [
              { kind: "fact", before: "甲", after: "乙", reason: "事实" },
              { kind: "literary", before: "丙", after: "丁", reason: "文学" },
            ],
          }
        : undefined,
    );
    p.ctx.onProgress = (run) => {
      if (run.status === "READER_DONE") originalAtEditor = run.status;
    };
    const run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    expect(originalAtEditor).toBe("READER_DONE");
    expect(run.status, run.error).toBe("AWAITING_CANDIDATE_APPROVAL");
    expect(await p.fs.readText(required(run.paths.original))).toBe(FAUX_PROSE);
    const root = required(run.paths.packet).replace("/packet.md", "");
    expect(
      JSON.parse(await p.fs.readText(`${root}/fact-changes.json`)),
    ).toHaveLength(1);
    expect(
      JSON.parse(await p.fs.readText(`${root}/literary-changes.json`)),
    ).toHaveLength(1);
  });
  it.each([
    "qingjie-heyanyuan",
    "xianshi-heyanyuan",
  ] as const)("inv-no-patch-sentences: %s failure returns to compiler", async (failed) => {
    const p = await setup((id) =>
      id === failed
        ? {
            pass: false,
            issues:
              failed === "qingjie-heyanyuan"
                ? [
                    {
                      promise: "粮车先离开",
                      problem: "missing",
                      evidence: "未发生",
                    },
                  ]
                : [
                    {
                      category: "institution",
                      rule_ref: "xiaoyan-yingsheding",
                      evidence: "不符合换马规定",
                    },
                  ],
          }
        : undefined,
    );
    const run = await startChapter(
      p.fs,
      { chapter: 1, lockedEvents: ["粮车先离开"] },
      p.ctx,
    );
    expect(run.status, run.error).toBe("RETURNED");
    expect(run.returnedTo).toBe("zhangjie-qingjing-bianyiyuan");
    expect(await p.fs.readText(required(run.paths.candidate))).toBe(FAUX_PROSE);
    expect(await p.fs.exists(run.target)).toBe(false);
  });
  it("rejects unready chapter and stale source without invoking any role", async () => {
    const p = await setup();
    await p.fs.write(PROJECTION, "陈旧情境");
    const run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    expect(run.status).toBe("FAILED_PRECONDITION");
    expect(run.roles).toEqual({});
  });
  it.each([
    "candidate",
    "packet",
    "projection",
  ] as const)("rejects stale %s at candidate approval and leaves approval pending", async (changed) => {
    const p = await setup();
    const run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    const path =
      changed === "candidate"
        ? required(run.paths.candidate)
        : changed === "packet"
          ? required(run.paths.source_packet)
          : PROJECTION;
    await p.fs.write(path, "changed");
    await expect(approve(p, run)).rejects.toThrow();
    expect((await loadRun(p.fs, run.id)).status).toBe(
      "AWAITING_CANDIDATE_APPROVAL",
    );
    expect(await p.fs.exists(run.target)).toBe(false);
  });
  it("refuses duplicate candidate approval and changes to a reviewed memory preview", async () => {
    const p = await setup();
    let run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    run = await approve(p, run);
    expect(run.status, run.error).toBe("AWAITING_MEMORY_APPROVAL");
    await expect(approve(p, run)).rejects.toThrow("not awaiting");
    await p.fs.write(required(run.paths.memory_preview), "changed");
    await expect(
      approveMemory(
        p.fs,
        run.id,
        { confirmed: true, expectedSha256: required(run.memoryPreviewSha256) },
        p.ctx,
      ),
    ).rejects.toThrow("changed");
  });
  it("memory role cannot patch an unreadable resource even with its correct hash", async () => {
    let bad: Data;
    const p = await setup((id) =>
      id === "jiyi-weihuyuan"
        ? {
            new_facts: [],
            state_changes: [],
            invalidated: [],
            scope_changes: [],
            next_chapter_state: "待讨论",
            patches: [bad],
          }
        : undefined,
    );
    bad = {
      path: "项目/项目章程.md",
      base_sha256: await p.fs.sha256("项目/项目章程.md"),
      new_content: "unauthorized",
    };
    const before = await p.fs.sha256("项目/项目章程.md");
    const run = await approve(
      p,
      await startChapter(p.fs, { chapter: 1 }, p.ctx),
    );
    expect(run.status).toBe("FAILED");
    expect(await p.fs.sha256("项目/项目章程.md")).toBe(before);
  });
  it("user can return or cancel a pending candidate; foreign project context is rejected", async () => {
    const p = await setup();
    const first = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    await expect(
      cancelRun(p.fs, first.id, { ...p.ctx, projectKey: "other" }),
    ).rejects.toThrow("mismatch");
    expect(
      (await returnCandidate(p.fs, first.id, "重新构思", p.ctx)).status,
    ).toBe("RETURNED");
    const second = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    expect((await cancelRun(p.fs, second.id, p.ctx)).status).toBe("CANCELLED");
  });
  it.each([
    "xiaoshuo-zuozhe",
    "qinggan-duzhe",
    "wenxue-bianji",
    "qingjie-heyanyuan",
    "xianshi-heyanyuan",
    "jiyi-weihuyuan",
  ] as const)("cancels active %s and retains incurred usage", async (role) => {
    const p = await setup();
    let id = "";
    p.ctx.onProgress = (run) => {
      id = run.id;
    };
    p.ctx.onRequest = (_request, current) => {
      if (current === role) void cancelRun(p.fs, id, p.ctx);
    };
    let run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    if (role === "jiyi-weihuyuan") run = await approve(p, run);
    expect(run.status, run.error).toBe("CANCELLED");
    expect(run.roles[role]).toBeDefined();
    expect((await loadRun(p.fs, run.id)).status).toBe("CANCELLED");
  });
});

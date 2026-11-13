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
import { candidateProblems, ledgers, state } from "@ruwen/core";
import { afterEach, describe, expect, it } from "vitest";
import { defaultFauxResponse, requestRole } from "../../agents/src/faux.ts";
import {
  failWrite,
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
  const problem = {
    location: "粮车先出了驿门",
    category: "explanation",
    condition: "PRIVATE_CONDITION_837",
    handling: "保留动作并删除重复解释",
    result: "PRIVATE_RESULT_957",
  };
  const editorWithProblem = (id: RoleId) =>
    id === "wenxue-bianji"
      ? { decision: "LOCAL_EDIT", edits: [], problems: [problem] }
      : undefined;
  it("successful editorial submission is recorded pending before approval; approval only changes status", async () => {
    const p = await setup(editorWithProblem);
    p.ctx.deferMemory = true;
    const registryHash = await p.fs.sha256("治理/资源注册表.json");
    const manifestHash = await p.fs.sha256(
      "authoring-ruwen-v5/manifests/author-manifest.json",
    );
    const run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    let entries = await ledgers.readEntries(p.fs, candidateProblems.PATH);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      ...problem,
      run_id: run.id,
      task_id: candidateProblems.taskId("test-project", "001"),
      status: "pending",
    });
    expect(await p.fs.exists(run.target)).toBe(false);
    expect((await approve(p, run)).status).toBe("CANDIDATE_APPROVED");
    entries = await ledgers.readEntries(p.fs, candidateProblems.PATH);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("approved");
    expect(await p.fs.sha256("治理/资源注册表.json")).toBe(registryHash);
    expect(
      await p.fs.sha256("authoring-ruwen-v5/manifests/author-manifest.json"),
    ).toBe(manifestHash);
    await expect(approve(p, run)).rejects.toThrow("not awaiting");
    expect(
      await ledgers.readEntries(p.fs, candidateProblems.PATH),
    ).toHaveLength(1);
  });
  it("editor ledger write failure cannot promote canon or continue to candidate approval", async () => {
    const p = await setup(editorWithProblem);
    const run = await startChapter(
      failWrite(p.fs, candidateProblems.PATH),
      { chapter: 1 },
      p.ctx,
    );
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("simulated write failure");
    expect(await p.fs.exists(run.target)).toBe(false);
    expect(
      await ledgers.readEntries(p.fs, candidateProblems.PATH),
    ).toHaveLength(0);
  });
  it("abandoned and returned candidates remain in statistics with updated candidate status", async () => {
    const p = await setup(editorWithProblem);
    const first = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    await cancelRun(p.fs, first.id, p.ctx);
    const second = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    await returnCandidate(p.fs, second.id, "重新考虑", p.ctx);
    const entries = await ledgers.readEntries(p.fs, candidateProblems.PATH);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.status)).toEqual([
      "abandoned",
      "returned",
    ]);
    expect(
      (await candidateProblems.counts(p.fs, "test-project")).categories,
    ).toEqual([
      {
        category: "explanation",
        count: 2,
        task_count: 1,
        recurrence_candidate: false,
      },
    ]);
    expect(
      await p.fs.readText(required(first.roles["wenxue-bianji"]?.path)),
    ).toContain("PRIVATE_CONDITION_837");
  });
  it("three rewrites of one chapter count as one task and replay does not duplicate an observation", async () => {
    const p = await setup(editorWithProblem);
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
      runs.push(run);
      await cancelRun(p.fs, run.id, p.ctx);
    }
    expect(
      (await candidateProblems.counts(p.fs, "test-project")).categories,
    ).toEqual([
      {
        category: "explanation",
        count: 3,
        task_count: 1,
        recurrence_candidate: false,
      },
    ]);
    await startChapter(
      p.fs,
      { chapter: 1 },
      { ...p.ctx, runId: required(runs[0]?.id) },
    );
    expect(
      await ledgers.readEntries(p.fs, candidateProblems.PATH),
    ).toHaveLength(3);
  }, 30000);
  it("memory patch must bind a resource actually read during this role run, even if its hash is known", async () => {
    let hash = "";
    const p = await setup((id) =>
      id === "jiyi-weihuyuan"
        ? {
            new_facts: [],
            state_changes: [],
            invalidated: [],
            scope_changes: [],
            next_chapter_state: "待确认",
            patches: [
              {
                path: "世界/当前态势.md",
                base_sha256: hash,
                sections: [
                  {
                    heading: "## 活跃力量与各自运动",
                    replacement: "不能绕过读取",
                  },
                ],
              },
            ],
          }
        : undefined,
    );
    hash = await p.fs.sha256("世界/当前态势.md");
    const run = await approve(
      p,
      await startChapter(p.fs, { chapter: 1 }, p.ctx),
    );
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("not read");
    expect(await p.fs.sha256("世界/当前态势.md")).toBe(hash);
  });
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
        ? {
            decision,
            edits: [],
            problems: [],
            return_reason: "需要重新处理场景压力。",
          }
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
            problems: [],
            edits: [
              {
                kind: "fact",
                original: "翻过",
                replacement: "翻开",
                reason: "事实",
              },
              {
                kind: "literary",
                original: "抵在",
                replacement: "贴着",
                reason: "文学",
              },
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
      sections: [{ heading: "## 项目身份", replacement: "unauthorized" }],
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
    let cancellation: ReturnType<typeof cancelRun> | undefined;
    p.ctx.onProgress = (run) => {
      id = run.id;
    };
    p.ctx.onRequest = (_request, current) => {
      if (current === role) cancellation = cancelRun(p.fs, id, p.ctx);
    };
    let run = await startChapter(p.fs, { chapter: 1 }, p.ctx);
    if (role === "jiyi-weihuyuan") run = await approve(p, run);
    await cancellation;
    expect(run.status, run.error).toBe("CANCELLED");
    expect(run.roles[role]).toBeDefined();
    expect((await loadRun(p.fs, run.id)).status).toBe("CANCELLED");
  });
});

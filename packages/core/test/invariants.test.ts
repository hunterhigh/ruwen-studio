import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as approval from "../src/approval/index.ts";
import {
  commitMemoryPreview,
  createMemoryPreview,
} from "../src/approval/memory-preview.ts";
import { governanceCheck } from "../src/checks/index.ts";
import type { ProjectFS } from "../src/fs/project-fs.ts";
import {
  appendAudit,
  appendProblem,
  problemSummary,
} from "../src/ledgers/index.ts";
import { compilePacket } from "../src/packet/index.ts";
import {
  REGISTRY,
  readRegistry,
  validateRegistry,
} from "../src/registry/index.ts";
import {
  chars,
  object,
  readJson,
  writeJson,
  writeText,
} from "../src/runtime.ts";
import {
  initState,
  loadState,
  promoteApproved,
  recordApproved,
  registerProjection,
} from "../src/state/index.ts";
import {
  CANDIDATE,
  FIELD,
  failWrite,
  MANIFEST,
  makeApproval,
  makeReady,
  PROJECTION,
  preparePacket,
  scope,
  temporaryProject,
  updateResource,
} from "./helpers.ts";

let project: Awaited<ReturnType<typeof temporaryProject>>;
let fs: ProjectFS;
beforeEach(async () => {
  project = await temporaryProject();
  fs = project.fs;
});
afterEach(async () => {
  await project.cleanup();
});
async function pendingMemory() {
  await preparePacket(fs);
  await fs.write(CANDIDATE, "驿吏让车夫先走。");
  const event = await makeApproval(
    fs,
    CANDIDATE,
    "candidate_approve",
    "inv-chapter",
  );
  await recordApproved(fs, CANDIDATE, "v1", event);
  await promoteApproved(fs, "chapters/001.md");
}
async function tree() {
  return Object.fromEntries(
    await Promise.all(
      (await fs.list()).map(async (p) => [p, await fs.sha256(p)]),
    ),
  );
}

describe("core invariants", () => {
  it("inv-candidate-not-canon", async () => {
    await preparePacket(fs);
    const registryBefore = await fs.sha256(REGISTRY);
    const worldBefore = await fs.sha256("世界/当前态势.md");
    const stateBefore = await fs.sha256("authoring-ruwen-v5/state.json");
    const chaptersBefore = await fs.list("chapters");
    await fs.write(CANDIDATE, "未经批准的候选。");
    const eventPath = await makeApproval(
      fs,
      CANDIDATE,
      "candidate_approve",
      "forged-approval",
    );
    const event = await readJson(fs, eventPath);
    event.approved_by = "assistant";
    await writeJson(fs, eventPath, event);
    await expect(
      recordApproved(fs, CANDIDATE, "v1", eventPath),
    ).rejects.toThrow();
    await expect(promoteApproved(fs, "chapters/001.md")).rejects.toThrow();
    expect(await fs.list("chapters")).toEqual(chaptersBefore);
    expect(await fs.exists("chapters/001.md")).toBe(false);
    expect(await fs.sha256(REGISTRY)).toBe(registryBefore);
    expect(await fs.sha256("世界/当前态势.md")).toBe(worldBefore);
    expect(await fs.sha256("authoring-ruwen-v5/state.json")).toBe(stateBefore);
  });
  it("inv-approval-once", async () => {
    const p = "治理/交接/target.json";
    await fs.write(p, "{}");
    const eventPath = await makeApproval(
      fs,
      p,
      "handoff_execute",
      "single-use",
    );
    const event = await readJson(fs, eventPath);
    await fs.write(p, "changed");
    await expect(
      approval.validateEvent(fs, event, "handoff_execute", p),
    ).rejects.toThrow("当前目标版本");
    await fs.write(p, "{}");
    const reservation = await approval.reserveEvent(
      fs,
      event,
      "gushi-gousishi",
    );
    await expect(
      approval.reserveEvent(fs, event, "gushi-gousishi"),
    ).rejects.toThrow();
    await approval.rollbackReservation(fs, reservation);
    expect(await approval.eventIsConsumed(fs, "single-use")).toBe(false);
    await approval.consumeEvent(fs, event, "gushi-gousishi");
    await expect(
      approval.consumeEvent(fs, event, "gushi-gousishi"),
    ).rejects.toThrow();
    expect(
      (await approval.usageEntries(fs)).filter(
        (e) => e.event_id === "single-use",
      ),
    ).toHaveLength(1);
  });
  it("inv-packet-budget", async () => {
    await preparePacket(fs);
    await updateResource(fs, "zhujue-pov-jingtou", "😀".repeat(900));
    const out = await compilePacket(fs, MANIFEST);
    expect(
      chars((await fs.readText(out.output)).replace(/\r\n/g, "\n")),
    ).toBeLessThanOrEqual(8000);
    await updateResource(fs, "zhujue-pov-jingtou", "😀".repeat(901));
    await expect(compilePacket(fs, MANIFEST)).rejects.toThrow("901 > 900");
    await updateResource(fs, "zhujue-pov-jingtou", "当前人物感知。");
    await updateResource(fs, "biaoxian-xiangmu-shengyin", "字".repeat(1201));
    await expect(compilePacket(fs, MANIFEST)).rejects.toThrow("1201 > 1200");
    await updateResource(fs, "biaoxian-xiangmu-shengyin", "叙述保持开放。");
    const manifest = await readJson(fs, MANIFEST);
    manifest.user_authored_text = {
      path: "authoring-ruwen-v5/exact-text/exact.md",
      confirmed_verbatim: true,
    };
    await writeJson(fs, MANIFEST, manifest);
    await fs.write("authoring-ruwen-v5/exact-text/exact.md", "😀".repeat(600));
    await compilePacket(fs, MANIFEST);
    await fs.write("authoring-ruwen-v5/exact-text/exact.md", "😀".repeat(601));
    await expect(compilePacket(fs, MANIFEST)).rejects.toThrow("601 > 600");
    await writeText(fs, PROJECTION, FIELD + "字".repeat(2201 - chars(FIELD)));
    await expect(
      registerProjection(fs, PROJECTION, "001", scope()),
    ).rejects.toThrow("ceiling");
  }, 20_000);
  it("rejects an oversized complete packet even when each source is within its own ceiling", async () => {
    await makeReady(fs);
    const previous = "chapters/previous.md";
    await fs.write(previous, "前".repeat(2400));
    await initState(fs, "故事/当前故事弧.md", ["character=人物/主角档案.md"], {
      lastApproved: previous,
    });
    await updateResource(fs, "biaoxian-xiangmu-shengyin", "叙".repeat(1200));
    await updateResource(fs, "zhujue-pov-jingtou", "感".repeat(900));
    const data = await readRegistry(fs);
    const pov = data.resources.find((r) => r.id === "zhujue-pov-jingtou");
    if (!pov) throw new Error("fixture");
    const relationship = "人物/关系镜头/当前.md";
    await fs.write(relationship, "关".repeat(900));
    const eventPath = await makeApproval(
      fs,
      relationship,
      "resource_activate",
      "relationship-active",
    );
    const event = await readJson(fs, eventPath);
    await approval.consumeEvent(fs, event, "xiangmu-zhiliyuan");
    data.resources.push({
      ...pov,
      id: "relationship-current",
      path: relationship,
      source_sha256: await fs.sha256(relationship),
      scope: { ...pov.scope, povs: null },
      approval: {
        status: "approved",
        approved_by: "user",
        approved_at: event.approved_at ?? null,
        approval_event_path: eventPath,
        approval_event_sha256: await fs.sha256(eventPath),
      },
    });
    await writeJson(fs, REGISTRY, data);
    await writeText(fs, PROJECTION, FIELD + "字".repeat(2200 - chars(FIELD)));
    await registerProjection(fs, PROJECTION, "001", scope());
    const manifest = await readJson(fs, MANIFEST);
    manifest.context_scope = scope();
    manifest.relationship_lens = relationship;
    manifest.approved_prose_tail = { path: previous, chars: 2400 };
    manifest.user_authored_text = {
      path: "authoring-ruwen-v5/exact-text/exact.md",
      confirmed_verbatim: true,
    };
    await fs.write("authoring-ruwen-v5/exact-text/exact.md", "文".repeat(600));
    manifest.maximum_context_characters = 8001;
    await writeJson(fs, MANIFEST, manifest);
    await expect(compilePacket(fs, MANIFEST)).rejects.toThrow(
      "between 3000 and 8000",
    );
    manifest.maximum_context_characters = 8000;
    await writeJson(fs, MANIFEST, manifest);
    const before = await tree();
    await expect(compilePacket(fs, MANIFEST)).rejects.toThrow(
      "packet exceeds maximum context",
    );
    expect(await tree()).toEqual(before);
  }, 20_000);
  it("inv-candidate-resource", async () => {
    await preparePacket(fs);
    const data = await readRegistry(fs);
    const voice = data.resources.find(
      (r) => r.id === "biaoxian-xiangmu-shengyin",
    );
    if (!voice) throw new Error("fixture");
    voice.status = "candidate";
    await writeJson(fs, REGISTRY, data);
    await expect(compilePacket(fs, MANIFEST)).rejects.toThrow("尚未激活");
    const manifest = await readJson(fs, MANIFEST);
    manifest.project_voice = "研究/README.md";
    await writeJson(fs, MANIFEST, manifest);
    await expect(compilePacket(fs, MANIFEST)).rejects.toThrow();
  });
  it("inv-preview-then-commit", async () => {
    await pendingMemory();
    const target = "世界/当前态势.md";
    const old = await fs.sha256(target);
    const registryBefore = await fs.sha256(REGISTRY);
    const auditBefore = await fs.sha256("治理/审计账本.jsonl");
    const preview = await createMemoryPreview(fs, "memory-preview", [
      { path: target, new_content: "# 当前态势\n\n驿站粮车已经离开。\n" },
    ]);
    expect(await fs.sha256(target)).toBe(old);
    expect(await fs.sha256(REGISTRY)).toBe(registryBefore);
    expect(await fs.sha256("治理/审计账本.jsonl")).toBe(auditBefore);
    await expect(
      commitMemoryPreview(fs, preview, "治理/审批/missing.json"),
    ).rejects.toThrow();
    const event = await makeApproval(
      fs,
      preview,
      "memory_commit",
      "memory-approval",
    );
    const before = await tree();
    await expect(
      commitMemoryPreview(failWrite(fs, REGISTRY), preview, event),
    ).rejects.toThrow("simulated write failure");
    expect(await tree()).toEqual(before);
    expect(await approval.eventIsConsumed(fs, "memory-approval")).toBe(false);
    await commitMemoryPreview(fs, preview, event);
    expect(await fs.sha256(target)).not.toBe(old);
    expect(await fs.sha256(REGISTRY)).not.toBe(registryBefore);
    expect(await fs.sha256("治理/审计账本.jsonl")).not.toBe(auditBefore);
    expect((await validateRegistry(fs)).errors).toEqual([]);
    expect((await loadState(fs)).pending_consolidation).toBe(false);
    await expect(commitMemoryPreview(fs, preview, event)).rejects.toThrow();
  }, 20_000);
  it("inv-ledger-separation", async () => {
    await appendProblem(fs, {
      location: "PRIVATE_SENTINEL",
      category: "解释重复",
      condition: "PRIVATE_SENTINEL",
      handling: "PRIVATE_SENTINEL",
      result: "PRIVATE_SENTINEL",
      task_id: "task-1",
      status: "open",
    });
    const summary = await problemSummary(fs);
    expect(JSON.stringify(summary)).not.toContain("PRIVATE_SENTINEL");
    await expect(
      appendAudit(fs, {
        role: "wenxue-bianji",
        private_problem: "PRIVATE_SENTINEL",
      }),
    ).rejects.toThrow();
    let privateReads = 0;
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "read" || key === "readText")
          return async (p: string) => {
            if (p === "治理/文学问题账本.jsonl") {
              privateReads++;
              throw new Error("private ledger unavailable to governance");
            }
            return key === "read" ? target.read(p) : target.readText(p);
          };
        const value: unknown = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const result = await governanceCheck(guarded);
    expect(privateReads).toBe(0);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
  });
  it("stale preview and disguised expression writes fail without consuming approval", async () => {
    await pendingMemory();
    const preview = await createMemoryPreview(fs, "stale-preview", [
      { path: "世界/当前态势.md", new_content: "updated" },
    ]);
    const event = await makeApproval(
      fs,
      preview,
      "memory_commit",
      "stale-memory",
    );
    await fs.write("世界/当前态势.md", "independent change");
    await expect(commitMemoryPreview(fs, preview, event)).rejects.toThrow(
      "陈旧",
    );
    expect(await approval.eventIsConsumed(fs, "stale-memory")).toBe(false);
    await expect(
      createMemoryPreview(fs, "bad-preview", [
        { path: "表现/项目声音.md", new_content: "unreviewed expression" },
      ]),
    ).rejects.toThrow();
  });
  it("memory preview binds every patch and rejects modified preview bytes", async () => {
    await pendingMemory();
    const preview = await createMemoryPreview(fs, "bound-preview", [
      { path: "世界/当前态势.md", new_content: "new canon" },
    ]);
    const event = await makeApproval(
      fs,
      preview,
      "memory_commit",
      "bound-memory",
    );
    const body = await readJson(fs, preview);
    const first = Array.isArray(body.patches) ? body.patches[0] : null;
    if (!object(first)) throw new Error("fixture");
    first.new_content = "tampered";
    await writeJson(fs, preview, body);
    const before = await tree();
    await expect(commitMemoryPreview(fs, preview, event)).rejects.toThrow(
      "当前目标版本",
    );
    expect(await tree()).toEqual(before);
  });
});

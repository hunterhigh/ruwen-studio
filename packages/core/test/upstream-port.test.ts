import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as approval from "../src/approval/index.ts";
import * as checks from "../src/checks/index.ts";
import { LocalDirFS } from "../src/fs/local-dir-fs.ts";
import * as handoff from "../src/handoff/index.ts";
import { initProject } from "../src/init/index.ts";
import * as ledgers from "../src/ledgers/index.ts";
import * as packet from "../src/packet/index.ts";
import * as registry from "../src/registry/index.ts";
import {
  type ObjectData,
  readJson,
  writeJson,
  writeText,
} from "../src/runtime.ts";
import * as state from "../src/state/index.ts";
import {
  CANDIDATE,
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

let fs: LocalDirFS;
let project: Awaited<ReturnType<typeof temporaryProject>>;
beforeEach(async () => {
  project = await temporaryProject();
  fs = project.fs;
});
afterEach(async () => {
  await project.cleanup();
});

const creative = (): ObjectData => ({
  kind: "creative_brief",
  sender: "chuangyi-xietiaoyuan",
  recipient: "gushi-gousishi",
  resource_ids: [],
  scope: { project: "test-project" },
  approval_ref: null,
  payload: {
    fixed: [],
    creative_value: "保留关系压力",
    unresolved_forces: [],
    open_realization: [],
    destination: "故事/当前故事弧.md",
    excluded_source: [],
  },
});
const consultant = (): ObjectData => ({
  kind: "consultant_brief",
  sender: "chuangyi-xietiaoyuan",
  recipient: "waibu-zhishi-guwen",
  resource_ids: ["shijie-zongbiao"],
  scope: { project: "test-project" },
  approval_ref: null,
  payload: {
    known: "驿道冬季运作",
    unknown: "换马的现实边界",
    learning_goal: "补足物质条件",
    boundary: "只调查交通制度",
    allowed_sources: ["权威史料"],
    destination: "研究/交通制度.md",
  },
});

describe("36 upstream scenarios ported to TypeScript", () => {
  it("test_project_blocks_incomplete_protagonist", async () => {
    const result = await checks.projectReadiness(fs);
    expect(result.ready).toBe(false);
    expect(result.errors.some((v) => v.includes("主角档案未完成"))).toBe(true);
  });
  it("test_ready_project_and_scope_selection", async () => {
    await makeReady(fs);
    expect((await checks.projectReadiness(fs)).ready).toBe(true);
    const selected = await registry.select(
      fs,
      {
        project: "test-project",
        volume: null,
        arc: null,
        chapter: null,
        scene_type: null,
        pov: "主角",
      },
      true,
    );
    const paths = selected.map((r) => r.path);
    expect(paths).toContain("表现/项目声音.md");
    expect(paths).toContain("人物/POV镜头/主角.md");
    expect(paths).not.toContain("人物/主角档案.md");
  });
  it("test_closure_audit_rejects_examples_and_mapping", async () => {
    const p = "表现/能力/危险.md";
    await fs.write(
      p,
      "政治就是对白。例如让官员先问账目，然后展示绳结，最后沉默。",
    );
    const result = await checks.closureAudit(fs, p);
    expect(result.pass).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "closed_mapping" }),
        expect.objectContaining({ category: "example_anchor" }),
      ]),
    );
  });
  it("test_closure_audit_rejects_sample_derived_emotion_ban", async () => {
    const p = "表现/能力/情绪禁令.md";
    await fs.write(p, "情绪不应直接命名，只能通过动作表现。");
    const result = await checks.closureAudit(fs, p);
    expect(result.pass).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "closed_mapping" }),
      ]),
    );
  });
  it("test_author_packet_uses_only_active_bounded_sources", async () => {
    const output = await preparePacket(fs);
    const content = await fs.readText(output);
    expect(content).toContain("# 当前章节情境");
    expect(content).not.toContain("# 主角档案");
    expect(content).not.toContain("研究/");
    expect(Array.from(content).length).toBeLessThanOrEqual(8000);
  });
  it("test_approval_promotion_and_memory_gate", async () => {
    await preparePacket(fs);
    await fs.write(CANDIDATE, "驿站中的非正典章节候选。");
    const event = await makeApproval(
      fs,
      CANDIDATE,
      "candidate_approve",
      "candidate-001",
    );
    expect(
      (await state.recordApproved(fs, CANDIDATE, "candidate-1", event))
        .pending_approved_candidate,
    ).not.toBeNull();
    expect(
      (await state.promoteApproved(fs, "chapters/chapter-001.md"))
        .pending_consolidation,
    ).toBe(true);
    expect(await fs.exists("chapters/chapter-001.md")).toBe(true);
    await expect(
      state.registerProjection(fs, PROJECTION, "002", scope("002")),
    ).rejects.toThrow();
    const preview = "authoring-ruwen-v5/reports/memory-001.json";
    await writeJson(fs, preview, { changes: [] });
    const memory = await makeApproval(
      fs,
      preview,
      "memory_commit",
      "memory-001",
    );
    expect(
      (
        await state.reconcileState(fs, {
          memoryPreview: preview,
          memoryApprovalEvent: memory,
        })
      ).pending_consolidation,
    ).toBe(false);
  });
  it("test_existing_chapter_replacement_requires_hash_and_archive", async () => {
    await preparePacket(fs);
    const target = "chapters/chapter-001.md";
    await fs.write(target, "旧正文");
    await fs.write(CANDIDATE, "新正文");
    const event = await makeApproval(
      fs,
      CANDIDATE,
      "candidate_approve",
      "candidate-replacement-001",
    );
    await state.recordApproved(fs, CANDIDATE, "replacement-1", event);
    await expect(state.promoteApproved(fs, target)).rejects.toThrow();
    const result = await state.promoteApproved(
      fs,
      target,
      true,
      await fs.sha256(target),
    );
    const history = result.approval_history.at(-1);
    expect(history).toBeDefined();
    const archive = history?.replacement_archive as ObjectData;
    expect(await fs.readText(String(archive.path))).toBe("旧正文");
  });
  it("test_generation_field_contamination_is_rejected", () => {
    expect(
      checks.projectionErrors(
        "1. 先写人物回家\n2. 再让人物解释意义\n3. 最后总结主题",
      ),
    ).toContain("numbered or bulleted beat-sheet form");
  });
  it("test_migration_preview_is_read_only", async () => {
    // V4.1 migration is explicitly outside P1. Its source remains opaque and untouched.
    const p = "legacy/author-voice/project-core.md";
    await fs.write(p, "旧项目声音");
    const before = await fs.sha256(p);
    await expect(
      initProject(new LocalDirFS(fs.displayPath("legacy")), "legacy-project"),
    ).rejects.toThrow("不会覆盖已有项目");
    expect(await fs.list("legacy")).toEqual([p]);
    expect(await fs.sha256(p)).toBe(before);
    expect(await fs.exists("表现/项目声音.md")).toBe(true);
    expect(await fs.readText("表现/项目声音.md")).not.toContain("旧项目声音");
  });
  it("test_retired_author_resource_is_rejected", async () => {
    await makeReady(fs);
    const data = await registry.readRegistry(fs);
    const item = data.resources.find((r) => r.id === "zhujue-pov-jingtou");
    if (!item) throw new Error("fixture");
    item.status = "retired";
    await writeJson(fs, registry.REGISTRY, data);
    expect(
      (
        await registry.select(
          fs,
          { project: "test-project", pov: "主角" },
          true,
        )
      ).map((r) => r.path),
    ).not.toContain(item.path);
  });
  it("test_problem_ledger_requires_cross_task_recurrence", async () => {
    const base = {
      location: "候选段落",
      category: "解释重复动作",
      condition: "关系场景",
      handling: "删除",
      result: "待用户评估",
      status: "open",
    };
    expect(
      (await ledgers.appendProblem(fs, { ...base, task_id: "t1" }))
        .recurrence_candidate,
    ).toBe(false);
    expect(
      (await ledgers.appendProblem(fs, { ...base, task_id: "t1" }))
        .recurrence_candidate,
    ).toBe(false);
    expect(
      (await ledgers.appendProblem(fs, { ...base, task_id: "t2" }))
        .recurrence_candidate,
    ).toBe(true);
  });
  it("test_governance_detects_manifest_leak", async () => {
    await makeReady(fs);
    const manifest = await readJson(fs, MANIFEST);
    manifest.project_voice = "研究/README.md";
    await writeJson(fs, MANIFEST, manifest);
    const result = await checks.governanceCheck(fs);
    expect(result.valid).toBe(false);
    expect(result.errors.some((v) => v.includes("越权"))).toBe(true);
  });
  it("test_handoff_rejects_raw_and_translated_input_together", async () => {
    const value = creative();
    (value.payload as ObjectData).raw_user_input = "原始请求";
    expect(
      (await handoff.validateHandoff(value)).some((v) =>
        v.includes("禁止字段"),
      ),
    ).toBe(true);
  });
  it("test_consultant_cannot_run_before_learning_plan_approval", async () => {
    expect(
      (
        await handoff.validateHandoff(consultant(), { forExecution: true, fs })
      ).some((v) => v.includes("独立批准事件")),
    ).toBe(true);
  });
  it("test_arc_scoped_expression_retires_cleanly", async () => {
    await makeReady(fs);
    const p = "表现/能力/弧线战斗.md";
    const id = "arc-one-combat";
    await writeText(
      fs,
      p,
      "身体负荷、地形和即时判断共同改变动作可行性；叙述距离随人物可确认的信息变化。",
    );
    const resource: registry.Resource = {
      id,
      path: p,
      type: "expression",
      owner: "biaoxian-shejishi",
      version: "1.0.0",
      status: "candidate",
      supersedes: null,
      scope: {
        project: "test-project",
        volumes: null,
        arcs: ["arc-1"],
        chapters: null,
        scene_types: ["combat"],
        povs: null,
      },
      readers: ["xiaoshuo-zuozhe"],
      allow_author: true,
      source_sha256: await fs.sha256(p),
      approval: { status: "unapproved", approved_at: null, approved_by: null },
    };
    const audit = "治理/激活证据/arc-closure.json";
    const trial = "治理/激活证据/arc-trial.json";
    const output = "治理/激活证据/arc-trial.md";
    const review = {
      resource_id: id,
      resource_path: fs.displayPath(p),
      resource_version: "1.0.0",
      resource_sha256: resource.source_sha256,
      reviewed_by: "user",
      checks: Object.fromEntries(checks.CHECK_NAMES.map((k) => [k, "pass"])),
    };
    await writeJson(
      fs,
      audit,
      await checks.closureAudit(fs, p, id, "1.0.0", review),
    );
    await fs.write(output, "非正典战斗试写。");
    await writeJson(fs, trial, {
      resource_id: id,
      resource_path: p,
      resource_version: "1.0.0",
      resource_sha256: resource.source_sha256,
      output_path: output,
      output_sha256: await fs.sha256(output),
      user_accepted: true,
      canonical: false,
    });
    resource.approval.closure_audit_path = audit;
    resource.approval.closure_audit_sha256 = await fs.sha256(audit);
    const data = await registry.readRegistry(fs);
    data.resources.push(resource);
    await writeJson(fs, registry.REGISTRY, data);
    const event = await makeApproval(
      fs,
      p,
      "expression_activate",
      "arc-one-combat-activate",
    );
    await registry.transition(fs, id, "active", {
      approved: true,
      approvalEvent: event,
      closureAudit: audit,
      trialReport: trial,
    });
    const query = {
      project: "test-project",
      arc: "arc-1",
      scene_type: "combat",
      pov: "主角",
    };
    expect((await registry.select(fs, query, true)).map((r) => r.id)).toContain(
      id,
    );
    await registry.transition(fs, id, "retired");
    expect(
      (await registry.select(fs, query, true)).map((r) => r.id),
    ).not.toContain(id);
  });
  it("test_author_core_budget_and_no_old_role_names", () => {
    expect(Array.from(packet.loadAuthorCore()).length).toBeLessThanOrEqual(420);
    for (const token of [
      "Story Steward",
      "Novelist",
      "Literary Editor",
      "Reality Keeper",
      "Creative Liaison",
    ])
      expect(packet.loadAuthorCore()).not.toContain(token);
  });
  it("test_manifest_cannot_self_declare_a_different_scope", async () => {
    await preparePacket(fs);
    const manifest = await readJson(fs, MANIFEST);
    (manifest.context_scope as ObjectData).chapter = "002";
    await writeJson(fs, MANIFEST, manifest);
    await expect(packet.compilePacket(fs, MANIFEST)).rejects.toThrow();
  });
  it("test_rogue_packet_and_tampered_meta_are_rejected", async () => {
    const p = await preparePacket(fs);
    const rogue = "authoring-ruwen-v5/packets/rogue.md";
    await fs.write(rogue, "伪造资料包");
    expect((await packet.checkPacket(fs, rogue)).valid).toBe(false);
    const meta = await readJson(fs, `${p}.meta.json`);
    meta.schema_version = "forged";
    await writeJson(fs, `${p}.meta.json`, meta);
    const result = await packet.checkPacket(fs, p);
    expect(result.valid).toBe(false);
    expect(result.reasons.some((v) => v.includes("schema"))).toBe(true);
  });
  it("test_silent_floor_and_protected_promotion_target", async () => {
    await preparePacket(fs);
    await fs.write(CANDIDATE, "根据以上要求，已完成所有要求。");
    let event = await makeApproval(
      fs,
      CANDIDATE,
      "candidate_approve",
      "silent-floor-001",
    );
    await expect(
      state.recordApproved(fs, CANDIDATE, "candidate-1", event),
    ).rejects.toThrow();
    await fs.write(CANDIDATE, "驿吏把木牌翻到背面，粮车仍在装袋。");
    event = await makeApproval(
      fs,
      CANDIDATE,
      "candidate_approve",
      "protected-target-001",
    );
    await state.recordApproved(fs, CANDIDATE, "candidate-2", event);
    await expect(
      state.promoteApproved(
        fs,
        "世界/世界总表.md",
        true,
        await fs.sha256("世界/世界总表.md"),
      ),
    ).rejects.toThrow();
  });
  it("test_candidate_approval_event_cannot_be_reused", async () => {
    await preparePacket(fs);
    await fs.write(CANDIDATE, "粮车先出了驿门。");
    const event = await makeApproval(
      fs,
      CANDIDATE,
      "candidate_approve",
      "single-use-001",
    );
    const result = await state.recordApproved(
      fs,
      CANDIDATE,
      "candidate-1",
      event,
    );
    await expect(
      approval.validateEvent(
        fs,
        await readJson(fs, event),
        "candidate_approve",
        CANDIDATE,
        result,
      ),
    ).rejects.toThrow();
  });
  it("test_reconcile_rejects_research_as_story_source", async () => {
    await preparePacket(fs);
    await expect(
      state.reconcileState(fs, { sources: ["research=研究/README.md"] }),
    ).rejects.toThrow();
  });
  it("test_reconcile_without_pending_memory_is_valid", async () => {
    await preparePacket(fs);
    const result = await state.reconcileState(fs);
    expect(result.pending_consolidation).toBe(false);
    expect((result.stale as ObjectData).projection).toBe(true);
  });
  it("test_placeholder_content_cannot_make_project_ready", async () => {
    await makeReady(fs);
    await updateResource(fs, "zhujue-dangan", "# 主角档案\n\n待用户确认。\n");
    const result = await checks.projectReadiness(fs);
    expect(result.ready).toBe(false);
    expect(
      result.errors.some((v) => v.includes("占位") || v.includes("未完成")),
    ).toBe(true);
  });
  it("test_active_expression_cannot_refresh_without_new_evidence", async () => {
    await makeReady(fs);
    await expect(
      registry.refreshHash(fs, "biaoxian-xiangmu-shengyin", true),
    ).rejects.toThrow();
  });
  it("test_expression_evidence_cannot_be_reused_for_another_resource", async () => {
    await makeReady(fs);
    const data = await registry.readRegistry(fs);
    const source = data.resources.find(
      (r) => r.id === "biaoxian-xiangmu-shengyin",
    );
    if (!source) throw new Error("fixture");
    const p = "表现/能力/复用证据.md";
    await fs.write(p, "人物的感知和社会处境共同影响叙述距离。");
    data.resources.push({
      ...source,
      id: "reused-evidence",
      path: p,
      status: "candidate",
      source_sha256: await fs.sha256(p),
      scope: { ...source.scope, scene_types: ["combat"] },
      approval: {
        status: "unapproved",
        approved_at: null,
        approved_by: null,
        closure_audit_path: source.approval.closure_audit_path ?? null,
        closure_audit_sha256: source.approval.closure_audit_sha256 ?? null,
      },
    });
    await writeJson(fs, registry.REGISTRY, data);
    expect(
      (await registry.validateRegistry(fs)).errors.some((e) =>
        e.includes("未绑定"),
      ),
    ).toBe(true);
  });
  it("test_generic_nested_input_key_is_rejected_from_handoff", async () => {
    const value = creative();
    (value.payload as ObjectData).creative_value = {
      content: "用户原始整段要求",
    };
    expect(
      (await handoff.validateHandoff(value)).some((e) =>
        e.includes("禁止字段"),
      ),
    ).toBe(true);
  });
  it("test_handoff_values_are_typed_and_raw_wording_is_checked_in_memory", async () => {
    const value = creative();
    const payload = value.payload as ObjectData;
    const raw = "让何绫更悲伤，比如她躲开饶景行的眼神，把这个写进人物卡。";
    payload.creative_value = raw;
    expect(
      (await handoff.validateHandoff(value, { rawSource: raw })).some((e) =>
        e.includes("长片段重合"),
      ),
    ).toBe(true);
    payload.creative_value = { verbatim_user_request: raw };
    expect(
      (await handoff.validateHandoff(value, { rawSource: raw })).some((e) =>
        e.includes("必须是有界文本"),
      ),
    ).toBe(true);
    payload.creative_value = "保留关系压力";
    payload.fixed = [raw];
    expect(
      (await handoff.validateHandoff(value, { rawSource: raw })).some((e) =>
        e.includes("长片段重合"),
      ),
    ).toBe(true);
  });
  it("test_handoff_approval_is_consumed_once", async () => {
    const value = consultant();
    const target = "治理/交接/consultant-001.json";
    await writeJson(fs, target, value.payload);
    const event = await makeApproval(
      fs,
      target,
      "handoff_execute",
      "handoff-001",
    );
    value.approval_ref = { path: event, sha256: await fs.sha256(event) };
    expect(
      await handoff.validateHandoff(value, { forExecution: true, fs }),
    ).toEqual([]);
    await handoff.consumeExecutionApproval(fs, value);
    expect(
      (await handoff.validateHandoff(value, { forExecution: true, fs })).length,
    ).toBeGreaterThan(0);
  });
  it("test_approval_event_validation_rejects_empty_identity_and_time", async () => {
    const p = "治理/交接/target.json";
    await fs.write(p, "{}");
    const event = {
      schema_version: "1.0",
      id: "",
      action: "handoff_execute",
      target_path: p,
      target_sha256: await fs.sha256(p),
      approved_at: null,
      approved_by: "user",
      consumed: false,
    };
    await expect(
      approval.validateEvent(fs, event, "handoff_execute", p),
    ).rejects.toThrow();
  });
  it("test_approval_consumption_is_atomic_across_processes", async () => {
    const target = "治理/交接/concurrent.json";
    await fs.write(target, "{}");
    const event = await makeApproval(
      fs,
      target,
      "handoff_execute",
      "concurrent-approval",
    );
    const moduleUrl = new URL("../src/approval/index.ts", import.meta.url).href;
    const code = `import {readFile} from 'node:fs/promises'; import {LocalDirFS} from ${JSON.stringify(new URL("../src/fs/local-dir-fs.ts", import.meta.url).href)}; import {consumeEvent} from ${JSON.stringify(moduleUrl)}; const fs=new LocalDirFS(process.argv[1]); const event=JSON.parse(await fs.readText(process.argv[2])); await consumeEvent(fs,event,'gushi-gousishi');`;
    const results = await Promise.all(
      Array.from(
        { length: 12 },
        () =>
          new Promise<number | null>((resolve, reject) => {
            const child = spawn(
              process.execPath,
              ["--input-type=module", "-e", code, fs.root, event],
              { stdio: "ignore", windowsHide: true },
            );
            child.on("error", reject);
            child.on("exit", resolve);
          }),
      ),
    );
    expect(results.filter((code) => code === 0)).toHaveLength(1);
    expect(
      (await fs.list(approval.USAGE)).filter((p) =>
        p.endsWith("/concurrent-approval.json"),
      ),
    ).toHaveLength(1);
  });
  it("test_failed_resource_commit_does_not_burn_approval", async () => {
    await registry.transition(fs, "xiangmu-zhangcheng", "candidate");
    const event = await makeApproval(
      fs,
      "项目/项目章程.md",
      "resource_activate",
      "resource-rollback",
    );
    const before = await fs.sha256(registry.REGISTRY);
    await expect(
      registry.transition(
        failWrite(fs, registry.REGISTRY),
        "xiangmu-zhangcheng",
        "active",
        { approved: true, approvalEvent: event },
      ),
    ).rejects.toThrow("simulated write failure");
    expect(await approval.eventIsConsumed(fs, "resource-rollback")).toBe(false);
    expect(await fs.sha256(registry.REGISTRY)).toBe(before);
  });
  it("test_research_directory_cannot_masquerade_as_world_resource", async () => {
    const data = await registry.readRegistry(fs);
    const p = "研究/伪装世界.md";
    await fs.write(p, "外部材料");
    const source = data.resources.find((r) => r.id === "shijie-zongbiao");
    if (!source) throw new Error("fixture");
    data.resources.push({
      ...source,
      id: "fake-world",
      path: p,
      source_sha256: await fs.sha256(p),
    });
    await writeJson(fs, registry.REGISTRY, data);
    expect(
      (await registry.validateRegistry(fs)).errors.some((e) =>
        e.includes("目录职责不一致"),
      ),
    ).toBe(true);
  });
  it("test_silent_floor_rejects_synonymous_compliance_language", () => {
    for (const content of [
      "本章逐项落实了大纲限制，研究来源均已核对。",
      "这一节依照设定清单写全了相关信息。",
      "这段文字已经依照既定规则写成，查证了相关材料的出处。",
      "这一节照着前述规范写完，所用史料也查过出处。",
      "正文执行了全部创作指示，参考材料已经查实。",
    ])
      expect(checks.candidateProseErrors(content).length).toBeGreaterThan(0);
  });
  it("test_migration_preview_cannot_write_inside_source", async () => {
    // The V4.1 migration command is deliberately unavailable, rather than silently writing a preview.
    const { main } = await import("../bin/ruwen-core.ts");
    const p = "legacy-source/world.md";
    await fs.write(p, "旧资料");
    const before = await fs.sha256(p);
    await expect(
      main([
        "migrate-v4-1-preview",
        "--project-root",
        fs.displayPath("legacy-source"),
        "--output",
        fs.displayPath("legacy-source/preview.json"),
      ]),
    ).rejects.toThrow("Unknown module");
    expect(await fs.exists("legacy-source/preview.json")).toBe(false);
    expect(await fs.sha256(p)).toBe(before);
  });
  it("test_project_id_injection_is_rejected", async () => {
    const target = new LocalDirFS(path.join(project.parent, "bad-project"));
    await expect(initProject(target, "bad'id")).rejects.toThrow();
    expect(await target.list()).toEqual([]);
  });
  it("test_project_initialization_is_atomic_and_valid", async () => {
    const target = new LocalDirFS(path.join(project.parent, "new-project"));
    await initProject(target, "new-project");
    const result = await registry.validateRegistry(target);
    expect(result.errors).toEqual([]);
    expect(
      result.data.resources.every(
        (item) => item.scope.project === "new-project",
      ),
    ).toBe(true);
    const script = fileURLToPath(
      new URL("../bin/ruwen-core.ts", import.meta.url),
    );
    expect(await readFile(script, "utf8")).not.toMatch(/child_process|python/);
  });
});

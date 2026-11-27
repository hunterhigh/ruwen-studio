import type { RunStatus } from "@ruwen/pipeline";
import { describe, expect, it } from "vitest";
import {
  chapterHeading,
  explainReadiness,
  groupChapterRuns,
  overviewProgress,
  runHref,
} from "./overview-data.ts";

describe("overview progress", () => {
  const cases: Record<RunStatus, [number | "done", string]> = {
    REQUESTED: [3, "progress"],
    READINESS_OK: [3, "progress"],
    PACKET_COMPILED: [3, "progress"],
    AUTHOR_DONE: [3, "progress"],
    READER_DONE: [3, "progress"],
    EDITOR_DONE: [3, "progress"],
    PLOT_CHECKED: [3, "progress"],
    REALITY_CHECKED: [3, "progress"],
    AWAITING_CANDIDATE_APPROVAL: [4, "review"],
    CANDIDATE_APPROVED: [5, "memory"],
    MEMORY_PREVIEW_READY: [5, "memory"],
    AWAITING_MEMORY_APPROVAL: [5, "memory"],
    MEMORY_COMMITTED: [5, "memory"],
    DONE: ["done", "next"],
    RETURNED: [3, "reason"],
    FAILED_PRECONDITION: [3, "reason"],
    FAILED: [3, "reason"],
    CANCELLED: [3, "reason"],
  };
  it.each(Object.entries(cases))("maps %s", (status, [step, action]) => {
    expect(
      overviewProgress({ ready: true, errors: [] }, status as RunStatus),
    ).toEqual({ step, action });
  });

  it("keeps the first step when the overview cannot establish chapter-specific readiness", () => {
    expect(overviewProgress({ ready: true, errors: [] })).toEqual({
      step: 1,
      action: "ideation",
    });
    expect(
      overviewProgress(
        { ready: false, errors: ["未识别的检查错误"] },
        "REQUESTED",
      ),
    ).toEqual({ step: 1, action: "ideation" });
    expect(
      overviewProgress({
        ready: false,
        errors: ["缺少必需文件：项目/项目章程.md", "projection is stale"],
      }),
    ).toEqual({ step: 1, action: "ideation" });
  });

  it("links to compilation when chapter context is the only named blocker", () => {
    expect(
      overviewProgress({
        ready: false,
        errors: ["Narrative projection is stale"],
      }),
    ).toEqual({
      step: 2,
      action: "compile",
    });
  });
});

describe("readiness messages", () => {
  it.each([
    ["缺少必需文件：项目/项目章程.md", "缺少项目章程。"],
    [
      "必需资料仍含初始化占位：项目/项目章程.md",
      "项目章程仍有待补写的占位内容。",
    ],
    ["主角档案未完成：客观存在模型", "主角档案还需补写主角的外在身份和处境。"],
    ["世界总表未完成：系统索引", "世界总表还需补写世界系统索引。"],
    [
      "必需资源尚未批准并激活：zhujue-pov-jingtou",
      "主角视角镜头还在等你批准并启用。",
    ],
    [
      "必需资源尚未批准并激活：unknown-resource",
      "一份必需资源还在等你批准并启用。",
    ],
    [
      "至少需要一个已批准并激活的正式世界系统",
      "至少需要一份已批准并启用的正式世界系统资料。",
    ],
    [
      "世界系统仍含初始化占位：system-north",
      "已启用的世界系统仍有待补写的内容。",
    ],
    ["项目声音尚未批准并激活", "项目声音还在等你批准并启用。"],
    ["demo-resource的来源哈希不匹配", "有一项资源登记需要核对。"],
  ])("explains %s without exposing resource identifiers", (input, message) => {
    expect(explainReadiness(input)).toEqual({
      message,
      destination: "ideation",
    });
  });

  it.each([
    "缺少已批准的章节情境",
    "Narrative projection is stale",
    "Cannot register a generation field",
  ])("recognizes %s as a compilation issue", (error) =>
    expect(explainReadiness(error)?.destination).toBe("compile"));

  it("leaves other diagnostics for the original-text fold", () => {
    expect(explainReadiness("未识别检查信息")).toBeUndefined();
  });
});

describe("chapter rows", () => {
  const common = {
    status: "DONE" as const,
    created_at: "2026-11-26T01:00:00.000Z",
  };
  it("filters non-chapter runs and groups successive attempts by chapter", () => {
    const grouped = groupChapterRuns([
      { ...common, id: "compile", kind: "compile", chapter: "9" },
      { ...common, id: "new-1", kind: "chapter_run", chapter: "1" },
      { ...common, id: "two", kind: "chapter_run", chapter: "2" },
      { ...common, id: "old-1", kind: "chapter_run", chapter: "001" },
      { ...common, id: "missing", kind: "chapter_run", chapter: null },
    ]);
    expect(grouped.map((rows) => rows.map(({ id }) => id))).toEqual([
      ["new-1", "old-1"],
      ["two"],
    ]);
  });

  it("derives a title only from the first manuscript line and preserves memory links", () => {
    expect(chapterHeading("# 第 1 章 · 换马\n\n后文")).toBe("换马");
    expect(chapterHeading("# 第 1 章\n\n后文")).toBeUndefined();
    expect(chapterHeading("正文先开始。\n\n# 后续小节")).toBeUndefined();
    expect(runHref("/projects/p", "run id", true)).toBe(
      "/projects/p/chapters?run=run+id&view=memory",
    );
  });
});

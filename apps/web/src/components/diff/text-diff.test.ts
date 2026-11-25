import { describe, expect, it } from "vitest";
import { diffText } from "./text-diff.ts";

describe("text diff", () => {
  it("aligns unchanged paragraphs and detects additions and deletions", () => {
    const diff = diffText(
      "开头\n\n删除一段\n\n转折\n\n收尾",
      "开头\n\n转折\n\n新增一段\n\n收尾",
    );
    expect(diff.counts).toEqual({ added: 1, removed: 1, changed: 0, same: 3 });
    expect(diff.groups[0]?.blocks).toEqual([
      { kind: "same", paragraphs: ["开头"] },
      { kind: "removed", text: "删除一段" },
      { kind: "same", paragraphs: ["转折"] },
      { kind: "added", text: "新增一段" },
      { kind: "same", paragraphs: ["收尾"] },
    ]);
  });

  it("diffs changed paragraphs by sentence and keeps common sentences", () => {
    const diff = diffText(
      "巷口无人。旧车留在树下。天快黑了。",
      "巷口无人。新车停在树下。天快黑了。",
    );
    expect(diff.groups[0]?.blocks).toEqual([
      {
        kind: "changed",
        before: [
          { text: "巷口无人。", changed: false },
          { text: "旧车留在树下。", changed: true },
          { text: "天快黑了。", changed: false },
        ],
        after: [
          { text: "巷口无人。", changed: false },
          { text: "新车停在树下。", changed: true },
          { text: "天快黑了。", changed: false },
        ],
      },
    ]);
  });

  it("coalesces each contiguous unchanged range for folding", () => {
    const diff = diffText("甲\r\n\r\n乙\n\n丙", "甲\n\n乙\n\n丙");
    expect(diff.groups[0]?.blocks).toEqual([
      { kind: "same", paragraphs: ["甲", "乙", "丙"] },
    ]);
  });

  it("keeps an unchanged final paragraph when another paragraph follows it", () => {
    expect(
      diffText("原文。\n", "原文。\n\n增补。\n").groups[0]?.blocks,
    ).toEqual([
      { kind: "same", paragraphs: ["原文。"] },
      { kind: "added", text: "增补。" },
    ]);
  });

  it("groups Markdown sections without consuming literal headings in code fences", () => {
    const diff = diffText(
      "## 秋日\n旧段。\n\n~~~md\n## 原样\n~~~\n## 冬日\n留下。",
      "## 秋日\n新段。\n\n~~~md\n## 原样\n~~~\n## 冬日\n留下。",
      true,
    );
    expect(diff.groups.map(({ heading }) => heading)).toEqual([
      "## 秋日",
      "## 冬日",
    ]);
    expect(diff.groups[0]?.blocks[1]).toEqual({
      kind: "same",
      paragraphs: ["~~~md\n## 原样\n~~~"],
    });
  });

  it("shows a new Markdown file as additions only", () => {
    const diff = diffText("", "## 驿站\n新记。\n\n他离开了。\n", true);
    expect(diff.emptyBefore).toBe(true);
    expect(diff.linesAfter).toBe(4);
    expect(diff.groups[0]?.kind).toBe("added");
    expect(diff.groups[0]?.blocks.map(({ kind }) => kind)).toEqual([
      "added",
      "added",
    ]);
    expect(diff.counts.removed).toBe(0);
  });

  it("handles empty files and a file emptied by a change", () => {
    expect(diffText("", "").groups).toEqual([]);
    expect(diffText("原内容", "").groups[0]?.blocks).toEqual([
      { kind: "removed", text: "原内容" },
    ]);
  });

  it("retains every paragraph when the LCS matrix would be too large", () => {
    const range = Array.from({ length: 1050 }, (_, i) => i);
    const previous = range.map((i) => `旧段${i}。`).join("\n\n");
    const next = range.map((i) => `新段${i}。`).join("\n\n");
    expect(diffText(previous, next).counts.changed).toBe(range.length);
  });
});

import { describe, expect, it } from "vitest";
import {
  applyEditorialEdits,
  applySectionEdits,
  type EditorialEdit,
  markdownSection,
} from "../src/text-edits.ts";

const policy = {
  maxChangedRatio: 0.15,
  maxReplacementChars: 1600,
  maxSectionChars: 4000,
};
const source = `开头${"甲".repeat(90)}左旧右${"乙".repeat(90)}结尾`;
const edit: EditorialEdit = {
  anchor_before: "左",
  anchor_after: "右",
  replacement: "新😀",
  kind: "fact",
  reason: "核对事实",
};
describe("deterministic local edits", () => {
  it("preserves every byte outside the anchored range and derives honest change records", () => {
    const result = applyEditorialEdits(source, [edit], policy);
    expect(result.text).toBe(source.replace("左旧右", "左新😀右"));
    expect(result.changes).toEqual([
      { kind: "fact", before: "旧", after: "新😀", reason: "核对事实" },
    ]);
  });
  it.each([
    ["not unique", { anchor_before: "甲" }],
    ["not found", { anchor_after: "不存在" }],
    ["reversed", { anchor_before: "右", anchor_after: "左" }],
    ["proportion", { replacement: "字".repeat(40) }],
  ])("rejects %s", (error, value) =>
    expect(() =>
      applyEditorialEdits(source, [{ ...edit, ...value }], policy),
    ).toThrow(error));
  it("enforces configurable lower ratio, single replacement cap and overlapping ranges", () => {
    expect(() =>
      applyEditorialEdits(source, [edit], {
        ...policy,
        maxChangedRatio: 0.001,
      }),
    ).toThrow("proportion");
    expect(() =>
      applyEditorialEdits(source, [edit], {
        ...policy,
        maxReplacementChars: 1,
      }),
    ).toThrow("single-edit");
    expect(() => applyEditorialEdits(source, [edit, edit], policy)).toThrow(
      "overlap",
    );
    expect(() =>
      applyEditorialEdits(source, [], { ...policy, maxChangedRatio: 1 }),
    ).toThrow("policy");
  });
  it("supports explicit BOF/EOF contexts without permitting a whole chapter rewrite", () => {
    expect(
      applyEditorialEdits(
        source,
        [
          {
            ...edit,
            anchor_before: "",
            anchor_after: "甲".repeat(90),
          },
        ],
        policy,
      ).text,
    ).toContain("新😀");
    expect(() =>
      applyEditorialEdits(
        source,
        [{ ...edit, anchor_before: "", anchor_after: "" }],
        policy,
      ),
    ).toThrow("proportion");
  });
});
it("section replacements preserve headings, other sections, fenced code and CRLF bytes", () => {
  const doc = "# 文档\r\n\r\n## 状态\r\n旧内容\r\n\r\n## 限制\r\n不可改\r\n";
  expect(
    applySectionEdits(
      doc,
      [{ heading: "## 状态", replacement: "\n新内容\n\n" }],
      policy,
    ),
  ).toBe("# 文档\r\n\r\n## 状态\r\n\r\n新内容\r\n\r\n## 限制\r\n不可改\r\n");
  const fenced = "## 状态\n```md\n## 只是示例\n```\n\n## 限制\n保留\n";
  expect(markdownSection(fenced, "## 状态").body).toContain("## 只是示例");
  expect(
    applySectionEdits(
      "## 状态",
      [{ heading: "## 状态", replacement: "新" }],
      policy,
    ),
  ).toBe("## 状态\n新\n");
});
it("missing, ambiguous, oversized and overlapping sections fail closed", () => {
  for (const [doc, edits, error] of [
    ["## A\n旧\n", [{ heading: "## B", replacement: "新" }], "does not exist"],
    [
      "## A\n旧\n## A\n另\n",
      [{ heading: "## A", replacement: "新" }],
      "not unique",
    ],
    [
      "## A\n旧\n",
      [{ heading: "## A", replacement: "字".repeat(4001) }],
      "limit",
    ],
    [
      "## A\n旧\n",
      [{ heading: "## A", replacement: "## B\n" }],
      "peer or parent",
    ],
    [
      "## A\n### B\n旧\n",
      [
        { heading: "## A", replacement: "新" },
        { heading: "### B", replacement: "新" },
      ],
      "overlap",
    ],
  ] as const)
    expect(() => applySectionEdits(doc, edits, policy)).toThrow(error);
});

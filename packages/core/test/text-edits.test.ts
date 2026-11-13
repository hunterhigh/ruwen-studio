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
  original: "旧",
  replacement: "新😀",
  kind: "fact",
  reason: "核对事实",
};
describe("deterministic local edits", () => {
  it("preserves every byte outside the selected original and derives honest change records", () => {
    const result = applyEditorialEdits(source, [edit], policy);
    expect(result.text).toBe(source.replace("左旧右", "左新😀右"));
    expect(result.changes).toEqual([
      { kind: "fact", before: "旧", after: "新😀", reason: "核对事实" },
    ]);
  });
  it.each([
    ["not unique", { original: "甲" }],
    ["not found", { original: "不存在" }],
    ["Invalid editorial", { original: "" }],
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
  it("supports original passages at either end without permitting a whole chapter rewrite", () => {
    expect(
      applyEditorialEdits(source, [{ ...edit, original: "开头" }], policy).text,
    ).toBe(source.replace("开头", "新😀"));
    expect(
      applyEditorialEdits(source, [{ ...edit, original: "结尾" }], policy).text,
    ).toBe(source.replace("结尾", "新😀"));
    expect(() =>
      applyEditorialEdits(source, [{ ...edit, original: source }], policy),
    ).toThrow("proportion");
    expect(() =>
      applyEditorialEdits(
        source,
        [{ ...edit, anchor_before: "左" } as EditorialEdit],
        policy,
      ),
    ).toThrow("Legacy boundary");
  });
  it("replaces the garden sentence in full and preserves its following opening quotation mark", () => {
    const original = "不是夸奖，不是比较，是他记得她站在旧墙边。可这不能说。";
    const garden = `${"远处灯火亮着。".repeat(80)}他张了张口。${original}\n\n“没什么，只是园子大，反而不亲近。”`;
    const replacement = "他记得她站在旧墙边。";
    const result = applyEditorialEdits(
      garden,
      [{ ...edit, original, replacement }],
      policy,
    );
    expect(result.text).toContain(`他张了张口。${replacement}\n\n“没什么`);
    expect(result.text).not.toContain("不是比较他记得");
  });
  it("rejects the garden doubled head gesture with the exact preserved neighbour in its error", () => {
    const garden = `${"远处灯火亮着。".repeat(80)}带起一阵很淡的旧年忍冬味。他没有抬头，只看见地上那片被捏坏的叶子。`;
    expect(() =>
      applyEditorialEdits(
        garden,
        [
          {
            ...edit,
            original: "旧年忍冬味。",
            replacement: "风。他没有抬头，只看见",
          },
        ],
        policy,
      ),
    ).toThrow(
      'edits[0].replacement ends with preserved right-neighbour text "他没有抬头，只看见"',
    );
  });
  it("rejects copied left neighbours and repetitions within a replacement or across operations", () => {
    const garden = `${"河面灯光摇动。".repeat(100)}他没有抬头，只看见旧词。`;
    expect(() =>
      applyEditorialEdits(
        garden,
        [{ ...edit, original: "旧词", replacement: "他没有抬头，只看见新词" }],
        policy,
      ),
    ).toThrow("preserved left-neighbour");
    expect(() =>
      applyEditorialEdits(
        source,
        [{ ...edit, replacement: "他没有抬头，只看见他没有抬头，只看见" }],
        policy,
      ),
    ).toThrow("adjacent repeated fragment");
    expect(() =>
      applyEditorialEdits(
        `${source}一二`,
        [
          { ...edit, original: "一", replacement: "六字以上片段" },
          { ...edit, original: "二", replacement: "六字以上片段" },
        ],
        policy,
      ),
    ).toThrow("adjacent repeated fragment");
    expect(
      applyEditorialEdits(`${source}他没有抬头他没有抬头`, [edit], policy).text,
    ).toContain("他没有抬头他没有抬头");
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

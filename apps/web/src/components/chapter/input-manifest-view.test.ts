import type { InputManifest } from "@ruwen/core";
import { describe, expect, it } from "vitest";
import { authorInputsSummary, roleInputsView } from "./input-manifest-view.ts";

const manifest: InputManifest = {
  version: 1,
  seen: [
    {
      label: "上一章正文尾部",
      kind: "chapter_tail",
      includedBecause: "pipeline_input",
      path: "chapters/0001.md",
      sha256: "a".repeat(64),
      chars: 600,
      truncated: true,
    },
  ],
  withheld: [
    { category: "full_character_profiles", ruleRef: "I4" },
    { category: "research", ruleRef: "I4" },
    { category: "story_outline", ruleRef: "I4" },
  ],
  rules: { upstreamFileCount: 8, chars: 12345 },
  totals: { inputChars: 6501, packetChars: 6320, packetBudget: 8000 },
};

describe("chapter role input records", () => {
  it("uses the returned labels, shows truncation and preserves technical metadata separately", () => {
    const view = roleInputsView(manifest, true);
    expect(view).toMatchObject({
      kind: "record",
      seen: [
        {
          label: "上一章正文尾部",
          size: "600 字（已截断）",
          path: "chapters/0001.md",
          sha256: "a".repeat(64),
        },
      ],
      rules: "8 份 · 12,345 字",
      packet: { text: "资料包 6,320 / 8,000 字", percent: 79 },
    });
    expect(roleInputsView(manifest, false)).toMatchObject({
      packet: undefined,
    });
  });

  it("maps categories and rules without echoing unrecognized backend values", () => {
    const view = roleInputsView(
      {
        ...manifest,
        withheld: [
          { category: "story_outline", ruleRef: "I4" },
          { category: "__proto__", ruleRef: "I4" },
          { category: "checklists", ruleRef: "unknown-rule" },
        ],
      },
      false,
    );
    expect(view).toMatchObject({
      withheld: [
        { labels: ["故事大纲"], reason: "按如文规则，小说作者不看故事大纲。" },
        {
          labels: ["其他受限材料", "检查表"],
          reason: "按岗位规则隔离这类材料。",
        },
      ],
    });
  });

  it("groups author exclusions once and deduplicates materials under the same rule", () => {
    expect(
      roleInputsView(
        {
          ...manifest,
          withheld: [
            ...manifest.withheld,
            { category: "research", ruleRef: "I4" },
          ],
        },
        true,
      ),
    ).toMatchObject({
      withheld: [
        {
          labels: ["人物全档", "研究资料", "故事大纲"],
          reason: "按如文规则，小说作者不看以下材料",
        },
      ],
    });
  });

  it("uses the legacy notice and omits the header summary when no manifest exists", () => {
    expect(roleInputsView(null, true)).toEqual({
      kind: "legacy",
      notice: "这次运行没有逐项记录",
    });
    expect(roleInputsView(undefined, false)).toEqual(
      roleInputsView(null, true),
    );
    expect(authorInputsSummary(null)).toBeUndefined();
  });

  it("does not assume a packet budget missing from a compatibility record", () => {
    expect(
      roleInputsView(
        {
          ...manifest,
          totals: { inputChars: 6501, packetChars: 6320 },
        },
        true,
      ),
    ).toMatchObject({
      packet: { text: "资料包 6,320 字", percent: undefined },
    });
  });

  it("builds the author summary from actual items, packet size and recorded restrictions", () => {
    expect(authorInputsSummary(manifest)).toBe(
      "本章小说作者只看到了 1 份资料（共 6,320 字），没有看到故事大纲、人物全档和研究资料。",
    );
    expect(
      authorInputsSummary({
        ...manifest,
        withheld: [],
        totals: { inputChars: 300 },
      }),
    ).toBe("本章小说作者只看到了 1 份资料（共 300 字）。");
  });
});

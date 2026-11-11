import { expect, it } from "vitest";
import {
  assertNoOriginalWording,
  OriginalWordingStream,
} from "../src/ideation/privacy.ts";
import { unpublishedFragments } from "../src/ideation/published.ts";

it("unpublished Unicode fragments retain their boundaries, including overlapping approvals", () => {
  expect(
    unpublishedFragments("甲😀乙丙丁戊", [
      { start: 2, end: 4 },
      { start: 1, end: 3 },
    ]),
  ).toEqual(["甲", "丁戊"]);
  const sources = unpublishedFragments("abcdefghijPUBLISHEDklmnopqrst", [
    { start: 10, end: 19 },
  ]);
  expect(sources).toEqual(["abcdefghij", "klmnopqrst"]);
  expect(() => assertNoOriginalWording("abcdefghijklm", sources)).not.toThrow();
  let visible = "";
  const stream = new OriginalWordingStream(sources, (text) => {
    visible += text;
  });
  expect(stream.push("abcdefghijklm")).toBe(true);
  stream.finish();
  expect(visible).toBe("abcdefghijklm");
  expect(() => unpublishedFragments("原话", [{ start: 0, end: 20 }])).toThrow(
    "OUTPUT_BLOCKED",
  );
});

it("unpublished phrases still block when split across streamed deltas", () => {
  const source = "UNPUBLISHED_PRIVATE_PHRASE_一二三四五六七八九十";
  let visible = "";
  const stream = new OriginalWordingStream([source], (text) => {
    visible += text;
  });
  expect(stream.push(source.slice(0, 7))).toBe(true);
  expect(stream.push(source.slice(7, 15))).toBe(false);
  stream.finish();
  expect(visible).not.toContain(source.slice(0, 12));
});

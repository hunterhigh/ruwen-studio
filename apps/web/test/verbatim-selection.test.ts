import { expect, it } from "vitest";
import { codepointSelection } from "../src/components/ideation/VerbatimSelection.tsx";

it("browser UTF-16 selection maps to whole codepoints and preserves original whitespace/newlines", () => {
  expect(codepointSelection("前😀甲\r\n乙 末", 1, 7)).toEqual({
    start: 1,
    end: 7,
    text: "😀甲\r\n乙 ",
  });
  expect(codepointSelection("😀".repeat(600), 0, 1200)?.end).toBe(600);
  expect(codepointSelection("😀".repeat(601), 0, 1202)?.end).toBe(601);
  for (const [start, end] of [
    [0, 1],
    [1, 2],
    [-1, 2],
    [0, 3],
    [1, 1],
    [0.5, 2],
  ])
    expect(codepointSelection("😀", start ?? -1, end ?? -1)).toBeNull();
});

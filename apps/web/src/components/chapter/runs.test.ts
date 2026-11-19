import { expect, it } from "vitest";
import { chapterRuns } from "./runs.ts";

it("preserves chapter runs and their order, excluding empty chapters and ideation jobs even with a chapter number", () => {
  const rows = [
    { id: "first", kind: "chapter_run", chapter: "002" },
    { id: "compile", kind: "ideation_dispatch", chapter: "999" },
    { id: "dialog", kind: "ideation_coordinator", chapter: null },
    { id: "task", kind: "ideation_execution", chapter: null },
    { id: "empty", kind: "chapter_run", chapter: "" },
    { id: "blank", kind: "chapter_run", chapter: "  " },
    { id: "missing", kind: "chapter_run", chapter: null },
    { id: "older", kind: "chapter_run", chapter: "001" },
  ];
  expect(chapterRuns(rows)).toEqual([rows[0], rows[7]]);
});

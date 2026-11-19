import { applyRanges } from "@ruwen/core";
import type { findRunAnnotations } from "@ruwen/db";
import {
  CandidateRevisionError,
  type CandidateRevisionOperation,
} from "@ruwen/pipeline";

export type AnnotationEditRequest = {
  op: Exclude<CandidateRevisionOperation, "manual">;
  editIds: string[];
};

export class AnnotationEditConflict extends CandidateRevisionError {
  readonly editIds: string[];

  constructor(editIds: string[]) {
    super(409, "这处已被改动，请在修改模式里手动处理");
    this.editIds = editIds;
  }
}

export function applyAnnotationEdits(
  text: string,
  request: AnnotationEditRequest,
  annotations: Awaited<ReturnType<typeof findRunAnnotations>>,
) {
  const revert = request.op === "revert_editor_edits";
  const failed = new Set<string>();
  const ranges: {
    id: string;
    start: number;
    end: number;
    replacement: string;
  }[] = [];
  for (const id of request.editIds) {
    const annotation = annotations.get(id);
    const edit = annotation?.finding as {
      original?: unknown;
      replacement?: unknown;
    } | null;
    if (
      annotation?.kind !== "editor" ||
      (annotation.status === "dismissed") === revert ||
      typeof edit?.original !== "string" ||
      typeof edit.replacement !== "string" ||
      edit.original === edit.replacement
    ) {
      failed.add(id);
      continue;
    }
    const [anchor, replacement] = revert
      ? [edit.replacement, edit.original]
      : [edit.original, edit.replacement];
    const start = text.indexOf(anchor);
    if (!anchor || start < 0 || text.indexOf(anchor, start + 1) >= 0) {
      failed.add(id);
      continue;
    }
    ranges.push({ id, start, end: start + anchor.length, replacement });
  }
  let furthest: (typeof ranges)[number] | undefined;
  for (const range of ranges.sort((a, b) => a.start - b.start)) {
    if (furthest && furthest.end > range.start) {
      failed.add(furthest.id);
      failed.add(range.id);
    }
    if (!furthest || furthest.end < range.end) furthest = range;
  }
  if (failed.size)
    throw new AnnotationEditConflict(
      request.editIds.filter((id) => failed.has(id)),
    );
  return applyRanges(text, ranges);
}

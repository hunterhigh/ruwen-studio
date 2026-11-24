import type { Edit, Reaction } from "./review-data.ts";

export interface Span {
  start: number;
  end: number;
}
export interface LocatedEdit extends Span {
  index: number;
  edit: Edit;
  cleanStart: number;
}

export function locateEdits(
  original: string,
  edits: readonly Edit[],
): LocatedEdit[] {
  const positions = edits
    .flatMap((edit, index) => {
      const start = original.indexOf(edit.original);
      return start >= 0 && original.indexOf(edit.original, start + 1) < 0
        ? [{ start, end: start + edit.original.length, index, edit }]
        : [];
    })
    .sort((a, b) => a.start - b.start);
  let offset = 0;
  return positions
    .filter(
      (item, i) =>
        !positions.some(
          (other, j) =>
            i !== j && other.start < item.end && item.start < other.end,
        ),
    )
    .map((item) => {
      const cleanStart = item.start + offset;
      offset += item.edit.replacement.length - (item.end - item.start);
      return { ...item, cleanStart };
    });
}
function literal(source: string, anchor: string): Span | undefined {
  const start = anchor ? source.indexOf(anchor) : -1;
  return start < 0 ? undefined : { start, end: start + anchor.length };
}

export function readerPosition(
  reaction: Reaction,
  original: string,
  clean: string,
  ranges: readonly LocatedEdit[],
) {
  const cleanSpan = literal(clean, reaction.anchor);
  const originalSpan = literal(original, reaction.anchor);
  let fallback: number | undefined;
  if (!cleanSpan && originalSpan) {
    let offset = 0;
    for (const edit of ranges) {
      if (edit.start >= originalSpan.end) break;
      if (edit.end > originalSpan.start) {
        fallback = edit.cleanStart;
        break;
      }
      offset += edit.edit.replacement.length - (edit.end - edit.start);
    }
    fallback ??= originalSpan.start + offset;
  }
  return { cleanSpan, originalSpan, fallback };
}

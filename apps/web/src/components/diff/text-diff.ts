type Match<T> =
  | { kind: "same"; before: T; after: T }
  | { kind: "removed"; before: T }
  | { kind: "added"; after: T };

const maxCells = 1_000_000;

function align<T>(
  before: readonly T[],
  after: readonly T[],
  equal: (a: T, b: T) => boolean,
): Match<T>[] {
  const result: Match<T>[] = [];
  const old = (index: number) => before[index] as T;
  const next = (index: number) => after[index] as T;
  let start = 0;
  let endOld = before.length;
  let endNew = after.length;
  while (start < endOld && start < endNew && equal(old(start), next(start))) {
    result.push({ kind: "same", before: old(start), after: next(start) });
    start++;
  }
  while (
    endOld > start &&
    endNew > start &&
    equal(old(endOld - 1), next(endNew - 1))
  ) {
    endOld--;
    endNew--;
  }

  let i = start;
  let j = start;
  const width = endNew - start + 1;
  const size = width * (endOld - start + 1);
  if (i < endOld && j < endNew && size <= maxCells) {
    const lengths = new Uint32Array(size);
    const cell = (x: number, y: number) => (x - start) * width + y - start;
    const length = (x: number, y: number) => lengths[cell(x, y)] ?? 0;
    for (let x = endOld - 1; x >= start; x--)
      for (let y = endNew - 1; y >= start; y--)
        lengths[cell(x, y)] = equal(old(x), next(y))
          ? length(x + 1, y + 1) + 1
          : Math.max(length(x + 1, y), length(x, y + 1));
    while (i < endOld && j < endNew) {
      if (equal(old(i), next(j))) {
        result.push({ kind: "same", before: old(i++), after: next(j++) });
      } else if (length(i + 1, j) >= length(i, j + 1)) {
        result.push({ kind: "removed", before: old(i++) });
      } else {
        result.push({ kind: "added", after: next(j++) });
      }
    }
  }
  // Large unmatched regions are still shown in full without a quadratic allocation.
  while (i < endOld) result.push({ kind: "removed", before: old(i++) });
  while (j < endNew) result.push({ kind: "added", after: next(j++) });
  for (let offset = 0; endOld + offset < before.length; offset++)
    result.push({
      kind: "same",
      before: old(endOld + offset),
      after: next(endNew + offset),
    });
  return result;
}

type Fragment = { text: string; changed: boolean };
export type DiffBlock =
  | { kind: "same"; paragraphs: string[] }
  | { kind: "removed" | "added"; text: string }
  | { kind: "changed"; before: Fragment[]; after: Fragment[] };

type Section = { heading: string; paragraphs: string[] };
type DiffSection = {
  heading: string;
  kind: Match<Section>["kind"];
  blocks: DiffBlock[];
};

function paragraphs(text: string) {
  return text
    .replace(/^(?:[^\S\n]*\n)+|(?:\n[^\S\n]*)+$/g, "")
    .split(/\n(?:[^\S\n]*\n)+/)
    .filter((part) => part.trim());
}

function sections(text: string, groupByHeading: boolean): Section[] {
  if (!groupByHeading) return [{ heading: "", paragraphs: paragraphs(text) }];
  const result: Section[] = [];
  let heading = "";
  let lines: string[] = [];
  let fence = "";
  const flush = () => {
    const blocks = paragraphs(lines.join("\n"));
    if (heading || blocks.length) result.push({ heading, paragraphs: blocks });
    lines = [];
  };
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker?.[1]) {
      if (!fence) fence = marker[1];
      else if (marker[1].startsWith(fence) && !marker[2]?.trim()) fence = "";
      lines.push(line);
      continue;
    }
    if (!fence && /^ {0,3}##\s+\S/.test(line)) {
      flush();
      heading = line;
    } else lines.push(line);
  }
  flush();
  return result;
}

const same = (a: string, b: string) => a === b;
const sentences = (text: string) =>
  text.match(/[\s\S]+?(?:[。！？!?；;…]+[”’」』）"']*|\.(?=\s|$)|$)/g) ?? [];

function compareSentences(before: string, after: string): DiffBlock {
  const left: Fragment[] = [];
  const right: Fragment[] = [];
  for (const item of align(sentences(before), sentences(after), same)) {
    if (item.kind !== "added")
      left.push({ text: item.before, changed: item.kind === "removed" });
    if (item.kind !== "removed")
      right.push({ text: item.after, changed: item.kind === "added" });
  }
  return { kind: "changed", before: left, after: right };
}

function compareParagraphs(before: string[], after: string[]) {
  const blocks: DiffBlock[] = [];
  let removals: string[] = [];
  let additions: string[] = [];
  const flush = () => {
    for (
      let index = 0;
      index < Math.max(removals.length, additions.length);
      index++
    ) {
      const old = removals[index];
      const next = additions[index];
      if (old !== undefined && next !== undefined)
        blocks.push(compareSentences(old, next));
      else if (old !== undefined) blocks.push({ kind: "removed", text: old });
      else if (next !== undefined) blocks.push({ kind: "added", text: next });
    }
    removals = [];
    additions = [];
  };
  for (const item of align(before, after, same)) {
    if (item.kind === "same") {
      flush();
      const last = blocks.at(-1);
      if (last?.kind === "same") last.paragraphs.push(item.before);
      else blocks.push({ kind: "same", paragraphs: [item.before] });
    } else if (item.kind === "removed") removals.push(item.before);
    else additions.push(item.after);
  }
  flush();
  return blocks;
}

export function diffText(
  before: string,
  after: string,
  groupByHeading = false,
) {
  const old = before.replace(/\r\n?/g, "\n");
  const next = after.replace(/\r\n?/g, "\n");
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };
  const groups: DiffSection[] = [];
  for (const item of align(
    sections(old, groupByHeading),
    sections(next, groupByHeading),
    (a, b) => a.heading === b.heading,
  )) {
    const previous = item.kind === "added" ? undefined : item.before;
    const current = item.kind === "removed" ? undefined : item.after;
    const heading = current?.heading ?? previous?.heading ?? "";
    const blocks = compareParagraphs(
      previous?.paragraphs ?? [],
      current?.paragraphs ?? [],
    );
    if (!heading && !blocks.length) continue;
    if (heading && item.kind !== "same") counts[item.kind]++;
    for (const block of blocks)
      counts[block.kind] += block.kind === "same" ? block.paragraphs.length : 1;
    groups.push({ heading, kind: item.kind, blocks });
  }
  return {
    groups,
    counts,
    emptyBefore: old.trim() === "",
    linesAfter: next.trim() ? next.trimEnd().split("\n").length : 0,
  };
}

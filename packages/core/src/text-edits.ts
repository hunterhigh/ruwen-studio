export interface EditPolicy {
  maxChangedRatio: number;
  maxReplacementChars: number;
  maxSectionChars: number;
}
export interface EditorialEdit {
  anchor_before: string;
  anchor_after: string;
  replacement: string;
  kind: "fact" | "literary";
  reason: string;
}
export interface SectionEdit {
  heading: string;
  replacement: string;
}
const size = (text: string) => Array.from(text).length;
function unique(source: string, anchor: string): number {
  const index = source.indexOf(anchor);
  if (index < 0) throw new Error("Edit anchor not found");
  if (source.indexOf(anchor, index + 1) >= 0)
    throw new Error("Edit anchor is not unique");
  return index;
}
function applyRanges(
  source: string,
  ranges: { start: number; end: number; replacement: string }[],
) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1],
      current = sorted[i];
    if (
      previous &&
      current &&
      (current.start < previous.end || current.start === previous.start)
    )
      throw new Error("Edit ranges overlap");
  }
  return sorted
    .reverse()
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.replacement + text.slice(edit.end),
      source,
    );
}
/** Anchors are preserved boundary contexts; empty anchors mean BOF/EOF. */
export function applyEditorialEdits(
  source: string,
  edits: readonly EditorialEdit[],
  policy: EditPolicy,
) {
  if (
    !(policy.maxChangedRatio > 0 && policy.maxChangedRatio <= 0.15) ||
    !Number.isInteger(policy.maxReplacementChars) ||
    policy.maxReplacementChars < 1
  )
    throw new Error("Invalid edit policy");
  let changed = 0;
  const changes = edits.map((edit) => {
    if (
      ![
        edit.anchor_before,
        edit.anchor_after,
        edit.replacement,
        edit.reason,
      ].every((v) => typeof v === "string") ||
      !["fact", "literary"].includes(edit.kind) ||
      !edit.reason.trim()
    )
      throw new Error("Invalid editorial edit");
    const start = edit.anchor_before
      ? unique(source, edit.anchor_before) + edit.anchor_before.length
      : 0;
    const end = edit.anchor_after
      ? unique(source, edit.anchor_after)
      : source.length;
    if (end < start) throw new Error("Edit anchors are reversed");
    const before = source.slice(start, end);
    const volume = Math.max(size(before), size(edit.replacement));
    if (volume > policy.maxReplacementChars)
      throw new Error("Replacement exceeds single-edit limit");
    changed += volume;
    return {
      start,
      end,
      replacement: edit.replacement,
      kind: edit.kind,
      before,
      after: edit.replacement,
      reason: edit.reason,
    };
  });
  if (changed > Math.floor(size(source) * policy.maxChangedRatio))
    throw new Error(
      "Replacements exceed configured proportion of original prose",
    );
  const text = applyRanges(source, changes);
  return {
    text,
    changes: changes.map(({ kind, before, after, reason }) => ({
      kind,
      before,
      after,
      reason,
    })),
  };
}
/** ATX headings outside fenced code; a section ends at the next peer/parent heading. */
function headings(source: string) {
  const result: {
    heading: string;
    level: number;
    start: number;
    body: number;
    eol: string;
  }[] = [];
  let fence: string | undefined;
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    if (!match[0]) continue;
    const line = match[0].replace(/\r?\n$/, "");
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length)
        fence = undefined;
      continue;
    }
    if (fence) continue;
    const heading = /^(#{1,6})[ \t]+[^\r\n]+$/.exec(line);
    if (heading?.[1])
      result.push({
        heading: line,
        level: heading[1].length,
        start: match.index,
        body: match.index + match[0].length,
        eol: match[0].endsWith("\r\n") ? "\r\n" : "\n",
      });
  }
  return result;
}
export function markdownSection(source: string, heading: string) {
  const all = headings(source),
    matches = all.filter((h) => h.heading === heading);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "Section heading is not unique"
        : "Section does not exist",
    );
  const selected = matches[0];
  if (!selected) throw new Error("Section does not exist");
  const end =
    all.find((h) => h.start > selected.start && h.level <= selected.level)
      ?.start ?? source.length;
  return {
    start: selected.body,
    end,
    level: selected.level,
    eol: selected.eol,
    body: source.slice(selected.body, end),
  };
}
export function applySectionEdits(
  source: string,
  edits: readonly SectionEdit[],
  policy: EditPolicy,
) {
  if (
    !Number.isInteger(policy.maxSectionChars) ||
    policy.maxSectionChars < 1 ||
    edits.length > 8
  )
    throw new Error("Invalid section edit policy or too many sections");
  const ranges = edits.map((edit) => {
    if (
      typeof edit.heading !== "string" ||
      typeof edit.replacement !== "string"
    )
      throw new Error("Invalid section edit");
    const section = markdownSection(source, edit.heading);
    if (
      Math.max(size(section.body), size(edit.replacement)) >
      policy.maxSectionChars
    )
      throw new Error("Section replacement exceeds limit");
    if (headings(edit.replacement).some((h) => h.level <= section.level))
      throw new Error(
        "Section replacement cannot introduce a peer or parent heading",
      );
    let replacement = edit.replacement
      .replace(/\r\n?/g, "\n")
      .replaceAll("\n", section.eol);
    if (replacement && !replacement.endsWith("\n")) replacement += section.eol;
    if (replacement && section.start > 0 && source[section.start - 1] !== "\n")
      replacement = section.eol + replacement;
    return { ...section, replacement };
  });
  return applyRanges(source, ranges);
}

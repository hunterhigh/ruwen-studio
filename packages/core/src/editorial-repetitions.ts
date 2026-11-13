/** Reject only newly introduced adjacent repeats; untouched repetitions in the author's prose remain valid. */
export function assertNoNewEditorialRepetition(
  source: string,
  result: string,
  changes: readonly {
    start: number;
    end: number;
    replacement: string;
    index: number;
  }[],
) {
  if (source === result) return;
  const characters = Array.from(result),
    origins: number[] = [];
  const affected: { start: number; end: number; index: number }[] = [];
  let cursor = 0,
    originalIndex = 0;
  for (const change of [...changes].sort((a, b) => a.start - b.start)) {
    for (const _ of source.slice(cursor, change.start))
      origins.push(originalIndex++);
    const before = source.slice(change.start, change.end),
      replacement = Array.from(change.replacement);
    affected.push({
      start: origins.length,
      end: origins.length + replacement.length,
      index: change.index,
    });
    for (let i = 0; i < replacement.length; i++)
      origins.push(before === change.replacement ? originalIndex + i : -1);
    originalIndex += Array.from(before).length;
    cursor = change.end;
  }
  for (const _ of source.slice(cursor)) origins.push(originalIndex++);
  const n = characters.length,
    breaks = new Uint32Array(n + 1),
    hashes = new Uint32Array(n + 1),
    powers = new Uint32Array(n + 1);
  powers[0] = 1;
  for (let i = 0; i < n; i++) {
    breaks[i + 1] =
      (breaks[i] ?? 0) +
      (origins[i] === -1 || (i > 0 && origins[i] !== (origins[i - 1] ?? 0) + 1)
        ? 1
        : 0);
    hashes[i + 1] =
      (Math.imul(hashes[i] ?? 0, 257) +
        (characters[i]?.codePointAt(0) ?? 0) +
        1) >>>
      0;
    powers[i + 1] = Math.imul(powers[i] ?? 0, 257) >>> 0;
  }
  const hash = (start: number, end: number) =>
    ((hashes[end] ?? 0) -
      Math.imul(hashes[start] ?? 0, powers[end - start] ?? 0)) >>>
    0;
  const seen = new Map<string, number[]>();
  for (let right = 0; right + 6 <= n; right++) {
    const key = characters.slice(right, right + 6).join("");
    const positions = seen.get(key) ?? [];
    for (const left of positions) {
      const period = right - left,
        end = right + period;
      if (period < 6 || end > n) continue;
      if ((origins[left] ?? -1) >= 0 && breaks[end] === breaks[left + 1])
        continue;
      if (hash(left, right) !== hash(right, end)) continue;
      const fragment = characters.slice(left, right).join("");
      // Hashes are only a fast filter. Verify the original Unicode text before rejecting anything.
      if (
        Array.from(fragment.replace(/\s/gu, "")).length < 6 ||
        fragment !== characters.slice(right, end).join("")
      )
        continue;
      const indexes = affected
        .filter((change) => change.start <= end && change.end >= left)
        .map((change) => `edits[${change.index}]`)
        .join(", ");
      const evidence = Array.from(fragment).slice(0, 100).join("");
      throw new Error(
        `${indexes}: Editorial replacement creates an adjacent repeated fragment: ${JSON.stringify(evidence)}. 修改后的两份片段紧邻出现；请重做 original → replacement，不要重复保留的正文。`,
      );
    }
    positions.push(right);
    seen.set(key, positions);
  }
}

/** A replacement may not copy a six-character-or-longer neighbour that the operation already preserves. */
export function assertNoEditorialBoundaryCopy(
  source: string,
  start: number,
  end: number,
  replacement: string,
  index: number,
) {
  const value = Array.from(replacement),
    left = Array.from(source.slice(0, start)),
    right = Array.from(source.slice(end));
  for (
    let length = Math.min(value.length, Math.max(left.length, right.length));
    length >= 6;
    length--
  ) {
    if (
      length <= left.length &&
      value.slice(0, length).join("") === left.slice(-length).join("")
    )
      throw new Error(
        `edits[${index}].replacement starts with preserved left-neighbour text ${JSON.stringify(left.slice(-length).join(""))}. original 前的正文会保留；不要再复制到 replacement 开头，或扩大 original 后完整替换。`,
      );
    if (
      length <= right.length &&
      value.slice(-length).join("") === right.slice(0, length).join("")
    )
      throw new Error(
        `edits[${index}].replacement ends with preserved right-neighbour text ${JSON.stringify(right.slice(0, length).join(""))}. original 后的正文会保留；不要再复制到 replacement 末尾，或扩大 original 后完整替换。`,
      );
  }
}

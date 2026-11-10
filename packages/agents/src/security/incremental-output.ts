import {
  type LeakDetector,
  type LeakKind,
  normalizeSecurityText,
} from "@ruwen/core";

const segmenter = new Intl.Segmenter("und", { granularity: "grapheme" });
export class StreamSuffixError extends Error {}
/** Map normalized suffixes to original UTF-16 offsets; never split a scalar/NFKC composition. */
function suffixStart(text: string, retain: number): number {
  const segments = [...segmenter.segment(text)];
  let count = 0,
    start = text.length;
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (!segment) continue;
    start = segment.index;
    count += Array.from(normalizeSecurityText(segment.segment)).length;
    // Keep the unfinished final grapheme even when it normalizes to an empty string.
    if (count >= retain) break;
  }
  return start;
}

/** Only an unresolved normalized suffix is withheld; published prose preserves exact raw bytes. */
export class IncrementalOutput {
  #pending = "";
  #publishedTail = "";
  #visible = 0;
  private readonly detector: LeakDetector;
  private readonly publish: (text: string) => void;
  constructor(detector: LeakDetector, publish: (text: string) => void) {
    this.detector = detector;
    this.publish = publish;
  }
  push(delta: string): LeakKind | undefined {
    this.#pending += delta;
    const kind = this.detector.check(this.#pending);
    if (kind) return kind;
    let end = suffixStart(
      this.#pending,
      this.detector.pendingLength(this.#pending),
    );
    const segments = [...segmenter.segment(this.#pending)];
    const lastStart = segments.at(-1)?.index ?? 0;
    const stable = this.#pending.slice(0, lastStart);
    const beforeUnfinished = this.detector.pendingLength(stable);
    // The final grapheme may still compose with the NEXT delta (e + ◌́ → é).
    // Keep a preceding matching prefix too, even if the current e does not match é yet.
    if (beforeUnfinished)
      end = Math.min(end, suffixStart(stable, beforeUnfinished));
    // Raw NFKC graphemes are indivisible. Fail closed on pathological combining runs,
    // rather than exceeding the normalized budget or publishing an unstable prefix.
    if (
      Array.from(normalizeSecurityText(this.#pending.slice(end))).length >
      this.detector.suffixBudget
    )
      throw new StreamSuffixError(
        "Unicode stream suffix exceeds the safety budget",
      );
    this.#release(end);
    return undefined;
  }
  #release(end: number): void {
    if (end <= this.#visible) return;
    const text = this.#pending.slice(this.#visible, end);
    this.publish(text);
    const recent = this.#publishedTail + text;
    this.#publishedTail = recent.slice(
      suffixStart(recent, this.detector.tailLength),
    );
    this.#pending = this.#pending.slice(end);
    this.#visible = 0;
  }
  finish(): void {
    this.#release(this.#pending.length);
  }
  visibleTail(): string {
    return this.#publishedTail;
  }
  discard(): void {
    // A correction must also be safe when concatenated with already published prose.
    this.#pending = this.#publishedTail;
    this.#visible = this.#pending.length;
  }
}

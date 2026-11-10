export const PROMPT_OVERLAP_LENGTH = 30;
export type LeakKind = "canary" | "prompt_overlap";
export type SecurityEventKind =
  | LeakKind
  | "internal_refusal"
  | "content_refusal";
export interface SecurityEvent {
  id: string;
  kind: SecurityEventKind;
}
export const normalizeSecurityText = (text: string) =>
  text.normalize("NFKC").replace(/[\p{White_Space}\p{P}]/gu, "");

function textLeaves(value: unknown): { values: string[]; keys: string[] } {
  const values: string[] = [],
    keys: string[] = [];
  const stack: unknown[] = [value];
  const visited = new Set<object>();
  while (stack.length) {
    const next = stack.pop();
    if (typeof next === "string") values.push(next);
    else if (next && typeof next === "object" && !visited.has(next)) {
      visited.add(next);
      if (Array.isArray(next)) stack.push(...[...next].reverse());
      else {
        const entries = Object.entries(next);
        keys.push(...entries.map(([key]) => key));
        stack.push(...entries.map(([, item]) => item).reverse());
      }
    }
  }
  return { values, keys };
}
function* windows(text: string, length: number): Generator<string> {
  const chars = Array.from(normalizeSecurityText(text));
  for (let i = 0; i + length <= chars.length; i++)
    yield chars.slice(i, i + length).join("");
}

/** No excerpts are returned or logged. Exempt only material actually sent to this role. */
export class LeakDetector {
  #prompt = new Set<string>();
  #provided = new Set<string>();
  #canary: string;
  #source: string;
  #prefixes = new Map<string, boolean>();
  readonly overlapLength: number;
  readonly tailLength: number;
  readonly suffixBudget: number;
  constructor(
    systemPrompt: string,
    canary: string,
    materials: unknown[] = [],
    overlapLength = PROMPT_OVERLAP_LENGTH,
  ) {
    if (!Number.isSafeInteger(overlapLength) || overlapLength < 1)
      throw new Error("Invalid prompt overlap length");
    this.overlapLength = overlapLength;
    this.#source = normalizeSecurityText(systemPrompt);
    this.#canary = normalizeSecurityText(canary);
    if (!this.#canary) throw new Error("Invalid deployment canary");
    this.tailLength = Math.max(
      overlapLength - 1,
      Array.from(this.#canary).length - 1,
    );
    this.suffixBudget = overlapLength - 1 + Array.from(canary).length;
    for (const window of windows(systemPrompt, overlapLength))
      this.#prompt.add(window);
    for (const material of materials) this.addMaterial(material);
  }
  addMaterial(value: unknown): void {
    this.#prefixes.clear();
    for (const text of textLeaves(value).values)
      for (const window of windows(text, this.overlapLength))
        if (this.#prompt.has(window)) this.#provided.add(window);
  }
  /** Longest normalized suffix that could complete a still-private window or the canary. */
  pendingLength(text: string): number {
    const chars = Array.from(normalizeSecurityText(text));
    for (
      let length = Math.min(this.tailLength, chars.length);
      length > 0;
      length--
    ) {
      const suffix = chars.slice(-length).join("");
      if (length < this.#canary.length && this.#canary.startsWith(suffix))
        return length;
      if (length >= this.overlapLength) continue;
      let possible = this.#prefixes.get(suffix);
      if (possible === undefined) {
        possible = false;
        for (
          let offset = this.#source.indexOf(suffix);
          offset !== -1;
          offset = this.#source.indexOf(suffix, offset + 1)
        ) {
          const window = Array.from(
            this.#source.slice(offset, offset + this.overlapLength * 2),
          )
            .slice(0, this.overlapLength)
            .join("");
          if (this.#prompt.has(window) && !this.#provided.has(window)) {
            possible = true;
            break;
          }
        }
        this.#prefixes.set(suffix, possible);
      }
      if (possible) return length;
    }
    return 0;
  }
  /** Private scanner state for joining fields/turns without rescanning complete prose. */
  tail(value: unknown): string {
    if (!this.tailLength) return "";
    return Array.from(normalizeSecurityText(textLeaves(value).values.join("")))
      .slice(-this.tailLength)
      .join("");
  }
  check(value: unknown): LeakKind | undefined {
    const { values, keys } = textLeaves(value);
    const texts = [...values, ...keys, values.join("")];
    // Canary always wins, including when the user supplied it or split it across fields.
    for (const text of texts)
      if (normalizeSecurityText(text).includes(this.#canary)) return "canary";
    for (const text of texts)
      for (const window of windows(text, this.overlapLength))
        if (this.#prompt.has(window) && !this.#provided.has(window))
          return "prompt_overlap";
    return undefined;
  }
}

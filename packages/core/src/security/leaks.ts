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
function* windows(text: string): Generator<string> {
  const chars = Array.from(normalizeSecurityText(text));
  for (let i = 0; i + PROMPT_OVERLAP_LENGTH <= chars.length; i++)
    yield chars.slice(i, i + PROMPT_OVERLAP_LENGTH).join("");
}

/** No excerpts are returned or logged. Exempt only material actually sent to this role. */
export class LeakDetector {
  #prompt = new Set<string>();
  #provided = new Set<string>();
  #canary: string;
  constructor(systemPrompt: string, canary: string, materials: unknown[] = []) {
    this.#canary = normalizeSecurityText(canary);
    if (!this.#canary) throw new Error("Invalid deployment canary");
    for (const window of windows(systemPrompt)) this.#prompt.add(window);
    for (const material of materials) this.addMaterial(material);
  }
  addMaterial(value: unknown): void {
    for (const text of textLeaves(value).values)
      for (const window of windows(text))
        if (this.#prompt.has(window)) this.#provided.add(window);
  }
  check(value: unknown): LeakKind | undefined {
    const { values, keys } = textLeaves(value);
    const texts = [...values, ...keys, values.join("")];
    // Canary always wins, including when the user supplied it or split it across fields.
    for (const text of texts)
      if (normalizeSecurityText(text).includes(this.#canary)) return "canary";
    for (const text of texts)
      for (const window of windows(text))
        if (this.#prompt.has(window) && !this.#provided.has(window))
          return "prompt_overlap";
    return undefined;
  }
}

import { securityLimits } from "../../../../config/security.ts";

export { securityLimits } from "../../../../config/security.ts";

export function assertMaterialText(text: string): void {
  if (Array.from(text).length > securityLimits().materialChars)
    throw new Error("资料超过允许的字符上限");
}

/** Iterative JSON traversal also rejects pollution keys, cycles and pathological structure. */
export function assertInputLimits(value: unknown): void {
  const limits = securityLimits();
  const stack: {
    value: unknown;
    depth: number;
    key: string;
    exit?: boolean;
  }[] = [{ value, depth: 0, key: "" }];
  const active = new Set<object>();
  let chars = 0,
    nodes = 0;
  while (stack.length) {
    const next = stack.pop();
    if (!next) break;
    if (next.exit) {
      active.delete(next.value as object);
      continue;
    }
    if (++nodes > limits.jsonNodes || next.depth > limits.jsonDepth)
      throw new Error("JSON structure exceeds the configured depth/node limit");
    if (typeof next.value === "string") {
      const length = Array.from(next.value).length;
      const chat =
        next.depth === 1 && ["raw_user_text", "message"].includes(next.key);
      if (length > (chat ? limits.chatChars : limits.materialChars))
        throw new Error(
          chat ? "消息超过允许的字符上限" : "资料超过允许的字符上限",
        );
      chars += length;
      if (chars > limits.inputChars) throw new Error("输入资料总长度超过上限");
    } else if (next.value && typeof next.value === "object") {
      if (active.has(next.value)) throw new Error("Cyclic JSON is not allowed");
      active.add(next.value);
      stack.push({ ...next, exit: true });
      const entries = Object.entries(next.value);
      for (const [key, item] of entries) {
        if (["__proto__", "prototype", "constructor"].includes(key))
          throw new Error("Unsafe JSON property");
        stack.push({ value: item, depth: next.depth + 1, key });
      }
    }
  }
}

export function assertImportedMaterial(p: string, bytes: Uint8Array): void {
  if (!/\.(?:md|txt|json|jsonl|csv|tsv)$/i.test(p)) return;
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assertMaterialText(text);
  if (/\.json$/i.test(p)) assertInputLimits(JSON.parse(text));
  if (/\.jsonl$/i.test(p))
    for (const line of text.split(/\r?\n/).filter((line) => line.trim()))
      assertInputLimits(JSON.parse(line));
}

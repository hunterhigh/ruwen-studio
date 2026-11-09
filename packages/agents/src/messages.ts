import type { Data, Json } from "./types.ts";

const labels: Record<string, string> = {
  prose: "正文",
  reading: "情感读者反应",
  approved_prose: "用户批准正文",
  previous_tail: "上一章批准正文尾部",
  raw_user_text: "用户当前表达",
  chapter: "章节号",
};
function readingText(value: Json): string {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray(value.reactions)
  )
    return value.reactions
      .map((reaction, index) => {
        if (
          !reaction ||
          typeof reaction !== "object" ||
          Array.isArray(reaction)
        )
          throw new Error("Invalid reader reaction");
        return `反应 ${index + 1}\n正文定位：${String(reaction.anchor ?? "")}\n类型：${String(reaction.type ?? "")}\n反应原文：\n${String(reaction.note ?? "")}`;
      })
      .join("\n\n");
  return JSON.stringify(value, null, 2);
}
/** Length-delimited raw bodies preserve even literal closing tags inside prose. */
export function formatUserMessage(input: Data): string {
  return Object.entries(input)
    .map(([key, value]) => {
      const label = labels[key] ?? "结构化资料";
      const format =
        typeof value === "string" || key === "reading" ? "text" : "json";
      const body =
        key === "reading"
          ? readingText(value)
          : typeof value === "string"
            ? value
            : JSON.stringify(value, null, 2);
      return `<${label} field="${key}" format="${format}" chars="${Array.from(body).length}">\n${body}\n</${label}>`;
    })
    .join("\n\n");
}
/** Debug/faux decoding only; production model input is always the raw segmented text. */
export function decodeUserMessage(message: string): Data | undefined {
  let offset = 0;
  const result: Data = {};
  while (offset < message.length) {
    const match =
      /^<([^ >]+) field="([a-z_]+)" format="(text|json)" chars="(\d+)">\n/.exec(
        message.slice(offset),
      );
    if (!match) return undefined;
    const [, label, key, format, count] = match;
    if (!label || !key) return undefined;
    offset += match[0].length;
    let length = 0,
      body = "";
    for (const char of message.slice(offset)) {
      if (length >= Number(count)) break;
      body += char;
      length++;
    }
    if (length !== Number(count)) return undefined;
    offset += body.length;
    const ending = `\n</${label}>`;
    if (!message.startsWith(ending, offset)) return undefined;
    offset += ending.length;
    result[key] = format === "json" ? (JSON.parse(body) as Json) : body;
    if (offset < message.length) {
      if (!message.startsWith("\n\n", offset)) return undefined;
      offset += 2;
    }
  }
  return Object.keys(result).length ? result : undefined;
}

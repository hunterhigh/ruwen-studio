import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RoleId, RoleSpec } from "../types.ts";

const PLUGIN = "01-完整插件/ruwen-xiezuo-xitong";
const conceptual: RoleId[] = [
  "chuangyi-xietiaoyuan",
  "xiangmu-zhiliyuan",
  "waibu-zhishi-guwen",
  "biaoxian-shejishi",
  "gushi-gousishi",
  "zhangjie-qingjing-bianyiyuan",
];
export const rolePromptFiles = (id: RoleId): RoleSpec["promptFiles"] => {
  const skill = conceptual.includes(id)
    ? "ruwen-gushi-gousi"
    : "ruwen-zhangjie-xiezuo";
  const files: { path: string; section?: "author_core" | "role_row" }[] = [
    { path: `${PLUGIN}/skills/${skill}/references/roles/${id}.md` },
  ];
  if (id === "xiaoshuo-zuozhe")
    files.push({
      path: `${PLUGIN}/skills/ruwen-zhangjie-xiezuo/CREATIVE-SOUL.md`,
      section: "author_core",
    });
  else if (conceptual.includes(id))
    files.push({ path: `${PLUGIN}/skills/ruwen-gushi-gousi/CREATIVE-SOUL.md` });
  if (id === "chuangyi-xietiaoyuan")
    files.push({ path: `${PLUGIN}/shared/creative-communication-contract.md` });
  return files;
};
export const defaultUpstreamRoot = fileURLToPath(
  new URL("../../../../vendor/ruwen/", import.meta.url),
);
export async function assemblePrompt(
  spec: RoleSpec,
  upstreamRoot = defaultUpstreamRoot,
): Promise<{ content: string; sha256: string }> {
  const fragments: string[] = [];
  for (const file of spec.promptFiles) {
    const resolved = path.resolve(upstreamRoot, file.path);
    const relative = path.relative(path.resolve(upstreamRoot), resolved);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !file.path.startsWith(`${PLUGIN}/`)
    )
      throw new Error("Prompt path escapes trusted upstream");
    let content = (await readFile(resolved, "utf8"))
      .replace(/\r\n?/g, "\n")
      .trim();
    if (file.section === "author_core") {
      const start = "<!-- AUTHOR_CORE_START -->";
      const end = "<!-- AUTHOR_CORE_END -->";
      if (content.split(start).length !== 2 || content.split(end).length !== 2)
        throw new Error("Invalid author core markers");
      content = content.split(start)[1]?.split(end)[0]?.trim() ?? "";
      if (!content || Array.from(content).length > 420)
        throw new Error("Invalid author core budget");
    }
    fragments.push(content);
  }
  const format =
    spec.output.kind === "text"
      ? "只输出候选正文，不输出说明。"
      : `最终结果必须调用 ${spec.output.toolName} 提交；不得仅用普通消息代替。`;
  const content = `${fragments.join("\n\n")}\n\nCURRENT_ROLE:${spec.id}\n${format}\n`;
  return {
    content,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

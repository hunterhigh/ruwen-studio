import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RoleId, RoleSpec } from "../types.ts";

export const PLUGIN = "01-完整插件/ruwen-xiezuo-xitong";
export const defaultUpstreamRoot = fileURLToPath(
  new URL("../../../../vendor/ruwen/", import.meta.url),
);
export const PLATFORM_NOTE =
  "平台附注：上游原文中提到的脚本、文件路径、其他岗位调用和用户批准均由平台代为执行。本岗位只使用当前提供的工具，结构化结果通过提交工具交付；小说作者依当前输出格式直接交付正文。平台未提供的操作不可自行执行，批准不可由本岗位代替用户作出。";
const conceptual: RoleId[] = [
  "chuangyi-xietiaoyuan",
  "xiangmu-zhiliyuan",
  "waibu-zhishi-guwen",
  "biaoxian-shejishi",
  "gushi-gousishi",
  "zhangjie-qingjing-bianyiyuan",
];
export const skillRoot = (id: RoleId) =>
  `${PLUGIN}/skills/${conceptual.includes(id) ? "ruwen-gushi-gousi" : "ruwen-zhangjie-xiezuo"}`;
function references(root: string): string[] {
  const walk = (relative: string): string[] =>
    readdirSync(path.join(defaultUpstreamRoot, root, "references", relative), {
      withFileTypes: true,
    })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .flatMap((entry) => {
        if (entry.name === "roles" || entry.name === "diagnostics") return [];
        if (entry.isSymbolicLink())
          throw new Error("Upstream reference cannot be a symlink");
        const next = relative ? `${relative}/${entry.name}` : entry.name;
        return entry.isDirectory()
          ? walk(next)
          : entry.isFile()
            ? [`${root}/references/${next}`]
            : [];
      });
  return walk("");
}
export const rolePromptFiles = (id: RoleId): RoleSpec["promptFiles"] => {
  const root = skillRoot(id),
    own = { path: `${root}/references/roles/${id}.md` };
  if (id === "qinggan-duzhe") return [own];
  // Explicit human-reviewed exception: author core remains in both system and packet.
  if (id === "xiaoshuo-zuozhe")
    return [own, { path: `${root}/CREATIVE-SOUL.md`, section: "author_core" }];
  return [
    { path: `${root}/SKILL.md` },
    { path: `${root}/CREATIVE-SOUL.md` },
    { path: `${PLUGIN}/shared/information-contract.md` },
    { path: `${PLUGIN}/shared/creative-communication-contract.md` },
    ...references(root).map((path) => ({ path })),
    own,
  ];
};
export async function assemblePrompt(
  spec: RoleSpec,
  upstreamRoot = defaultUpstreamRoot,
): Promise<{ content: string; sha256: string }> {
  const fragments: string[] = [];
  for (const file of spec.promptFiles) {
    const resolved = path.resolve(upstreamRoot, file.path),
      relative = path.relative(path.resolve(upstreamRoot), resolved);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !file.path.startsWith(`${PLUGIN}/`)
    )
      throw new Error("Prompt path escapes trusted upstream");
    let content = (await readFile(resolved, "utf8")).replace(/\r\n?/g, "\n");
    if (file.section === "author_core") {
      const start = "<!-- AUTHOR_CORE_START -->",
        end = "<!-- AUTHOR_CORE_END -->";
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
  const editing =
    spec.id === "wenxue-bianji"
      ? "\n平台提交格式：LOCAL_EDIT仅提交edits锚点替换，不返回整章。anchor_before与anchor_after是保留的原稿边界文本，分别必须唯一；空字符串分别表示篇首、篇尾；只替换两者之间的内容。锚点最多200字，单项删除/插入最多1600字，总替换量（各项删除/插入较大者之和）最多原稿15%，具体配置可能更低。RESTAGE/RETURN_CONSTRUCTION的edits必须为空并给return_reason。每个文学问题以location、category、condition、handling、result记录在problems；无问题时为空。"
      : spec.id === "jiyi-weihuyuan"
        ? "\n平台提交格式：先按需读取资源；patches只引用本次实际读取的path与base_sha256。每项sections按完整Markdown标题heading替换其正文replacement，保留标题及其他小节；标题必须存在且唯一，不得引入同级或更高标题。每资源最多8小节，每小节最多4000字；不返回整份new_content。"
        : "";
  const content = `${fragments.join("\n\n")}\n\n${PLATFORM_NOTE}\n\nCURRENT_ROLE:${spec.id}${editing}\n${format}\n`;
  return {
    content,
    sha256: createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

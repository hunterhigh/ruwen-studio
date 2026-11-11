import path from "node:path";
import { comparePaths } from "../fs/order.ts";
import type { ProjectFS } from "../fs/project-fs.ts";
import { digest } from "../runtime.ts";

// Keep upstream order, prefix matching and proposed paths, including its suffix quirks.
const RULES = [
  [
    "author-voice/pov-lenses/",
    "character",
    "人物/POV镜头/",
    "需要人工核对人物事实与文字接口是否混合",
  ],
  [
    "author-voice/relationship-lenses/",
    "character",
    "人物/关系镜头/",
    "需要声明POV与故事弧作用域",
  ],
  [
    "author-voice/scene-modes/",
    "expression",
    "表现/能力/",
    "必须通过闭合风险审计和试写",
  ],
  [
    "author-voice/project-core.md",
    "expression",
    "表现/项目声音.md",
    "必须去除来源名、例子和剧情答案",
  ],
  ["characters/", "character", "人物/", "主角必须拆成三模型档案"],
  ["world/", "world", "世界/", "百科材料需归入世界总表或正式系统"],
  ["continuity/", "world", "世界/当前态势.md", "时间状态与稳定Canon需人工拆分"],
  ["outlines/", "story", "故事/", "保留故事设计，不进入小说作者资料包"],
] as const;

export interface V41Classification {
  type: "character" | "expression" | "world" | "story" | "governance";
  proposed_path: string;
  note: string;
}
export function classifyV41Path(relative: string): V41Classification {
  const normalized = relative.replaceAll("\\", "/");
  for (const [prefix, type, target, note] of RULES) {
    if (normalized.startsWith(prefix))
      return {
        type,
        proposed_path:
          target +
          (prefix.endsWith("/") ? normalized.slice(prefix.length) : ""),
        note,
      };
  }
  return {
    type: "governance",
    proposed_path: `治理/待人工归类/${path.posix.basename(normalized)}`,
    note: "混合或未知职责，不自动迁移",
  };
}
export interface V41MigrationPreview {
  source_root: string;
  mode: "read_only_preview";
  files: (V41Classification & {
    source_path: string;
    source_sha256: string;
    action: "preview_only";
  })[];
  warnings: string[];
}

/** Read-only classification. The result is advice, never an approved patch or registry. */
export async function migrateV41Preview(
  fs: ProjectFS,
): Promise<V41MigrationPreview> {
  return fs.transaction(async (tx) => {
    const files: V41MigrationPreview["files"] = [];
    for (const relative of (await tx.list()).sort(comparePaths)) {
      if (
        relative.startsWith("authoring-v4-1/packets/") ||
        relative.includes("__pycache__")
      )
        continue;
      files.push({
        source_path: relative,
        source_sha256: digest(await tx.read(relative)),
        ...classifyV41Path(relative),
        action: "preview_only",
      });
    }
    return {
      source_root: tx.root,
      mode: "read_only_preview",
      files,
      warnings: ["未移动或改写任何文件", "所有拆分与作用域仍需用户批准"],
    };
  });
}

import { createHash } from "node:crypto";
import type { Message } from "@earendil-works/pi-ai";
import {
  type InputManifest,
  type InputManifestItem,
  type PacketInputManifest,
  resourceInputLabel,
} from "@ruwen/core";
import type { Data, Json, RoleId } from "./types.ts";

export interface InputMessage {
  message: string;
  manifest: InputManifest;
}

export interface InputManifestContext {
  packet?: PacketInputManifest | undefined;
  previousTailTruncated?: boolean | undefined;
  resourceTitles?: ReadonlyMap<string, string>;
}

const fields: Record<string, [InputManifestItem["kind"], string]> = {
  prose: ["prose", "正文"],
  approved_prose: ["prose", "已批准正文"],
  previous_tail: ["chapter_tail", "上一章正文尾部"],
  reading: ["reader_reactions", "情感读者反应"],
  locked_events: ["locked_events", "必须发生的事件"],
  locked_order: ["locked_events", "锁定顺序"],
  raw_user_text: ["user_messages", "用户原话"],
  conversation: ["user_messages", "当前会话的消息"],
  brief: ["delegation", "已批准的委托"],
  approved_learning_plan: ["delegation", "已批准的学习计划"],
  trial_candidate: ["delegation", "本次试写材料"],
  noncanonical_trial: ["delegation", "试写约束"],
  chapter: ["resource", "章节号"],
  scope: ["resource", "资料作用域"],
  project_state: ["resource", "项目标识"],
  resource_ids: ["resource", "委托所列的资料索引"],
};
const resourceFields = new Set([
  "resources",
  "approved_resources",
  "approved_story",
  "hard_rules",
]);
const diagnosticLabels: Record<string, string> = {
  "attention-and-structure": "注意力与结构诊断",
  "dialogue-and-encounter": "对话与相遇诊断",
  explanation: "解释性文字诊断",
  "face-and-affect": "神态与情绪诊断",
};

export const inputChars = (text: string) => Array.from(text).length;
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const record = (value: unknown): value is Data =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function item(
  kind: InputManifestItem["kind"],
  label: string,
  content: string,
  includedBecause: InputManifestItem["includedBecause"] = "pipeline_input",
): InputManifestItem {
  return {
    kind,
    label,
    chars: inputChars(content),
    truncated: false,
    includedBecause,
  };
}

function resourceItem(
  value: Data,
  kind: "resource" | "hard_rules",
  includedBecause: "registry_reader" | "tool_call",
  titles?: ReadonlyMap<string, string>,
): InputManifestItem {
  const path = typeof value.path === "string" ? value.path : undefined;
  const id = typeof value.id === "string" ? value.id : undefined;
  const content = typeof value.content === "string" ? value.content : undefined;
  const name = path
    ? resourceInputLabel(path, id ? titles?.get(id) : undefined)
    : "资料";
  return {
    ...item(
      kind,
      content === undefined ? `${name}（资料索引）` : name,
      content ?? JSON.stringify(value, null, 2),
      includedBecause,
    ),
    ...(id ? { resourceId: id } : {}),
    ...(path ? { path } : {}),
    ...(content === undefined ? {} : { sha256: digest(content) }),
  };
}

export function fieldManifest(
  key: string,
  value: Json,
  raw: string,
  context: InputManifestContext,
): InputManifestItem[] {
  if (value === null || value === "" || (Array.isArray(value) && !value.length))
    return [];
  if (resourceFields.has(key)) {
    const kind = key === "hard_rules" ? "hard_rules" : "resource";
    return (Array.isArray(value) ? value : [value]).map((entry) =>
      record(entry)
        ? resourceItem(entry, kind, "registry_reader", context.resourceTitles)
        : item(
            kind,
            key === "hard_rules" ? "硬设定规则" : "已批准资料",
            String(entry),
          ),
    );
  }
  const [kind, label] = fields[key] ?? ["resource", "结构化资料"];
  return [
    {
      ...item(kind, label, raw),
      ...(key === "prose" || key === "approved_prose" || key === "previous_tail"
        ? { sha256: digest(raw) }
        : {}),
      truncated:
        key === "previous_tail" && context.previousTailTruncated === true,
    },
  ];
}

export function builtInput(
  message: string,
  seen: InputManifestItem[],
  withheld: readonly InputManifest["withheld"][number][],
): InputMessage {
  return {
    message,
    manifest: {
      version: 1,
      seen,
      withheld: [...withheld],
      rules: { upstreamFileCount: 0, chars: 0 },
      totals: { inputChars: inputChars(message) },
    },
  };
}

export function authorInput(
  message: string,
  withheld: readonly InputManifest["withheld"][number][],
  packet?: PacketInputManifest,
): InputMessage {
  if (packet && packet.sha256 === digest(message)) {
    const input = builtInput(message, packet.seen, withheld);
    input.manifest.totals.packetChars = packet.packetChars;
    input.manifest.totals.packetBudget = packet.packetBudget;
    return input;
  }
  const input = builtInput(
    message,
    [
      {
        ...item("packet_section", "作者资料包", message, "packet"),
        sha256: digest(message),
      },
    ],
    withheld,
  );
  input.manifest.totals.packetChars = inputChars(message);
  return input;
}

export function toolInput(
  message: Extract<Message, { role: "toolResult" }>,
  titles: ReadonlyMap<string, string>,
): { seen: InputManifestItem; chars: number } | undefined {
  if (message.isError) return;
  const content = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const details = message.details;
  let seen: InputManifestItem;
  switch (message.toolName) {
    case "read_resource":
      if (!record(details) || typeof details.content !== "string") return;
      seen = resourceItem(details, "resource", "tool_call", titles);
      break;
    case "load_diagnostic":
      if (!record(details) || typeof details.content !== "string") return;
      seen = {
        ...item(
          "diagnostic",
          diagnosticLabels[String(details.name)] ?? "编辑诊断",
          details.content,
          "tool_call",
        ),
        sha256: digest(details.content),
      };
      break;
    case "list_resources":
      seen = item("resource", "可读资料索引", content, "tool_call");
      break;
    case "read_problem_summary":
      seen = item("resource", "文学问题类别与复发统计", content, "tool_call");
      break;
    case "web_search":
      seen = item("resource", "外部调查结果", content, "tool_call");
      break;
    default:
      return;
  }
  return { seen, chars: inputChars(content) };
}

const concealed = (categories: string[], ruleRef: string) =>
  categories.map((category) => ({ category, ruleRef }));
const rawWording = concealed(["raw_user_wording"], "I6");
const writeSkill = "ruwen-zhangjie-xiezuo/SKILL.md#固定岗位链";

export const roleWithheld: Readonly<
  Record<RoleId, readonly InputManifest["withheld"][number][]>
> = {
  "chuangyi-xietiaoyuan": concealed(["translated_delegation"], "I6"),
  "xiangmu-zhiliyuan": [
    ...rawWording,
    ...concealed(["literary_ledger_details"], "I10"),
  ],
  "waibu-zhishi-guwen": rawWording,
  "biaoxian-shejishi": rawWording,
  "gushi-gousishi": rawWording,
  "zhangjie-qingjing-bianyiyuan": rawWording,
  "xiaoshuo-zuozhe": concealed(
    [
      "full_character_profiles",
      "world_materials",
      "story_outline",
      "research",
      "governance",
      "validation",
      "literary_ledger",
      "later_role_opinions",
      "source_list",
    ],
    "I4",
  ),
  "qinggan-duzhe": concealed(["story_outline", "checklists"], "I5"),
  "wenxue-bianji": concealed(
    ["full_literary_checklist"],
    "ruwen-zhangjie-xiezuo/SKILL.md#阅读与编辑",
  ),
  "qingjie-heyanyuan": concealed(
    ["reader_reactions", "editor_edits"],
    writeSkill,
  ),
  "xianshi-heyanyuan": concealed(
    ["reader_reactions", "editor_edits"],
    writeSkill,
  ),
  "jiyi-weihuyuan": concealed(
    ["unapproved_prose", "unapproved_inferences"],
    "I1",
  ),
};

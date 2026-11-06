import { isDeepStrictEqual } from "node:util";
import * as approval from "../approval/index.ts";
import type { ProjectFS } from "../fs/project-fs.ts";
import {
  chars,
  keysEqual,
  type ObjectData,
  object,
  readJson,
  text,
  under,
} from "../runtime.ts";
import { CONTEXT_SCOPE_KEYS } from "../state/index.ts";

const BASE = [
  "kind",
  "sender",
  "recipient",
  "resource_ids",
  "scope",
  "approval_ref",
  "payload",
];
const FORBIDDEN = [
  "raw_user_input",
  "original_prompt",
  "complaint_history",
  "editor_ledger",
  "blind_review",
  "source_trace",
  "reasoning",
  "failure_log",
  "content",
  "text",
  "message",
  "prompt",
  "input",
  "instructions",
];
const RECIPIENTS: Record<string, string[]> = {
  creative_brief: [
    "gushi-gousishi",
    "xiangmu-zhiliyuan",
    "wenxue-bianji",
    "biaoxian-shejishi",
    "waibu-zhishi-guwen",
  ],
  consultant_brief: ["waibu-zhishi-guwen"],
  governance_preview: ["user", "xiangmu-zhiliyuan"],
  expression_candidate: ["user", "xiangmu-zhiliyuan", "biaoxian-shejishi"],
  chapter_situation: ["xiaoshuo-zuozhe"],
  memory_change_preview: ["user", "jiyi-weihuyuan", "xiangmu-zhiliyuan"],
};
const PAYLOADS: Record<string, string[]> = {
  creative_brief: [
    "fixed",
    "creative_value",
    "unresolved_forces",
    "open_realization",
    "destination",
    "excluded_source",
  ],
  consultant_brief: [
    "known",
    "unknown",
    "learning_goal",
    "boundary",
    "allowed_sources",
    "destination",
  ],
  governance_preview: [
    "changes",
    "conflicts",
    "scope_changes",
    "writes_requested",
  ],
  expression_candidate: [
    "resource_id",
    "resource_path",
    "resource_sha256",
    "scope",
    "status",
  ],
  chapter_situation: [
    "projection_path",
    "projection_sha256",
    "chapter",
    "scope",
  ],
  memory_change_preview: [
    "preview_path",
    "preview_sha256",
    "changes",
    "retirements",
  ],
};
const EXCLUDED = [
  "raw_user_wording",
  "example",
  "complaint_language",
  "correction_history",
  "implementation_route",
  "approval_dialogue",
  "unused_option",
];
const textOk = (value: unknown, max = 1200) =>
  text(value) && chars(value.trim()) > 0 && chars(value.trim()) <= max;
const listOk = (value: unknown, items = 32, max = 600) =>
  Array.isArray(value) &&
  value.length <= items &&
  value.every((x) => textOk(x, max));
const scopeOk = (value: unknown) =>
  object(value) &&
  Object.hasOwn(value, "project") &&
  Object.keys(value).every((k) => CONTEXT_SCOPE_KEYS.includes(k)) &&
  Object.values(value).every((v) => v === null || textOk(v, 120));
export function payloadValueErrors(
  kind: string,
  payload: ObjectData,
): string[] {
  const errors: string[] = [];
  if (kind === "creative_brief") {
    if (!listOk(payload.fixed))
      errors.push("creative_brief.fixed必须是有界文本数组");
    if (!textOk(payload.creative_value))
      errors.push("creative_brief.creative_value必须是有界文本");
    for (const k of ["unresolved_forces", "open_realization"])
      if (!listOk(payload[k]))
        errors.push(`creative_brief.${k}必须是有界文本数组`);
    if (
      !Array.isArray(payload.excluded_source) ||
      !payload.excluded_source.every((v) => text(v) && EXCLUDED.includes(v))
    )
      errors.push("creative_brief.excluded_source只能使用固定来源类别");
    if (!textOk(payload.destination, 300))
      errors.push("creative_brief.destination无效");
  } else if (kind === "consultant_brief") {
    for (const k of [
      "known",
      "unknown",
      "learning_goal",
      "boundary",
      "destination",
    ])
      if (!textOk(payload[k]))
        errors.push(`consultant_brief.${k}必须是有界文本`);
    if (!listOk(payload.allowed_sources, 16, 200))
      errors.push("consultant_brief.allowed_sources必须是有界文本数组");
  } else if (kind === "governance_preview") {
    for (const k of [
      "changes",
      "conflicts",
      "scope_changes",
      "writes_requested",
    ])
      if (!listOk(payload[k], 64))
        errors.push(`governance_preview.${k}必须是有界文本数组`);
  } else if (["expression_candidate", "chapter_situation"].includes(kind)) {
    const keys =
      kind === "expression_candidate"
        ? ["resource_id", "resource_path", "resource_sha256", "status"]
        : ["projection_path", "projection_sha256", "chapter"];
    for (const k of keys)
      if (!textOk(payload[k], 300)) errors.push(`${kind}.${k}无效`);
    if (!scopeOk(payload.scope)) errors.push(`${kind}.scope无效`);
  } else if (kind === "memory_change_preview") {
    for (const k of ["preview_path", "preview_sha256"])
      if (!textOk(payload[k], 300))
        errors.push(`memory_change_preview.${k}无效`);
    for (const k of ["changes", "retirements"])
      if (!listOk(payload[k], 64))
        errors.push(`memory_change_preview.${k}必须是有界文本数组`);
  }
  return errors;
}
function nestedKeys(value: unknown): string[] {
  if (object(value))
    return [...Object.keys(value), ...Object.values(value).flatMap(nestedKeys)];
  if (Array.isArray(value)) return value.flatMap(nestedKeys);
  return [];
}
function textValues(value: unknown, p = "payload"): [string, string][] {
  if (text(value)) return [[p, value]];
  if (Array.isArray(value))
    return value.flatMap((v, i) => textValues(v, `${p}[${i}]`));
  if (object(value))
    return Object.entries(value).flatMap(([k, v]) =>
      textValues(v, `${p}.${k}`),
    );
  return [];
}
const folds: Record<string, string> = {
  ß: "ss",
  ſ: "s",
  ﬀ: "ff",
  ﬁ: "fi",
  ﬂ: "fl",
  ﬃ: "ffi",
  ﬄ: "ffl",
  ﬅ: "st",
  ﬆ: "st",
};
const normalized = (value: string) =>
  value
    .toLowerCase()
    .replace(/[ßſﬀﬁﬂﬃﬄﬅﬆ]/g, (c) => folds[c] ?? c)
    .replace(/[^0-9a-z\u3400-\u9fff]+/g, "");
export function sourceOverlapErrors(
  payload: ObjectData,
  rawSource: string,
): string[] {
  const raw = normalized(rawSource);
  if (raw.length < 12) return [];
  const grams = new Set(
    Array.from({ length: Math.max(1, raw.length - 19) }, (_, i) =>
      raw.slice(i, i + 20),
    ),
  );
  const errors: string[] = [];
  for (const [p, v] of textValues(payload)) {
    const candidate = normalized(v);
    if (candidate.length < 12) continue;
    if (
      candidate.includes(raw) ||
      (candidate.length >= 16 && raw.includes(candidate)) ||
      (raw.length >= 20 && [...grams].some((g) => candidate.includes(g)))
    )
      errors.push(`${p}与原始用户措辞存在长片段重合`);
  }
  return errors;
}
export interface HandoffOptions {
  forExecution?: boolean;
  fs?: ProjectFS;
  rawSource?: string;
}
export async function validateHandoff(
  value: unknown,
  options: HandoffOptions = {},
): Promise<string[]> {
  if (!object(value)) return ["交接物必须是对象"];
  const errors: string[] = [];
  if (!keysEqual(value, BASE))
    errors.push("交接物顶层字段必须与白名单完全一致");
  const kind =
    text(value.kind) && Object.hasOwn(RECIPIENTS, value.kind) ? value.kind : "";
  const recipient = text(value.recipient) ? value.recipient : "";
  if (!Object.hasOwn(RECIPIENTS, kind)) errors.push("未知交接物类型");
  if (RECIPIENTS[kind] && !RECIPIENTS[kind]?.includes(recipient))
    errors.push("接收岗位与交接物类型不匹配");
  if (!text(value.sender) || !value.sender) errors.push("sender无效");
  if (
    !Array.isArray(value.resource_ids) ||
    !value.resource_ids.every((v) => text(v) && /^[a-z0-9-]{2,64}$/.test(v))
  )
    errors.push("resource_ids必须是数组");
  if (!scopeOk(value.scope)) errors.push("scope必须是对象");
  if (value.approval_ref != null && !object(value.approval_ref))
    errors.push("approval_ref必须是对象或null");
  if (!object(value.payload)) errors.push("payload必须是对象");
  else if (PAYLOADS[kind] && !keysEqual(value.payload, PAYLOADS[kind]))
    errors.push("payload字段与交接物类型不匹配");
  else if (PAYLOADS[kind]) {
    errors.push(...payloadValueErrors(kind, value.payload));
    if (options.rawSource !== undefined)
      errors.push(...sourceOverlapErrors(value.payload, options.rawSource));
  }
  const contaminated = [
    ...new Set(nestedKeys(value).filter((k) => FORBIDDEN.includes(k))),
  ].sort();
  if (contaminated.length)
    errors.push(`交接物含禁止字段：${contaminated.join(", ")}`);
  if (kind === "chapter_situation" && object(value.payload)) {
    const leaked = [
      ...new Set(
        nestedKeys(value.payload).filter((k) =>
          [
            "research",
            "governance",
            "editor_diagnostics",
            "source_list",
            "planning_reason",
          ].includes(k),
        ),
      ),
    ].sort();
    if (leaked.length) errors.push(`章节情境含下游污染：${leaked.join(", ")}`);
  }
  if (
    options.forExecution &&
    ["creative_brief", "consultant_brief", "chapter_situation"].includes(kind)
  ) {
    const fs = options.fs;
    const a = value.approval_ref;
    if (!fs || !object(a) || !keysEqual(a, ["path", "sha256"]))
      errors.push("执行下游岗位需要独立批准事件引用");
    else {
      try {
        const p = fs.path(String(a.path));
        under(p, "治理/审批", "批准事件必须位于治理/审批/");
        const event = await readJson(fs, p);
        if ((await fs.sha256(p)) !== a.sha256)
          throw new Error("批准事件哈希不匹配");
        const target = fs.path(String(event.target_path));
        under(target, "治理/交接", "批准目标必须位于治理/交接/");
        await approval.validateEvent(fs, event, "handoff_execute", target);
        if (!isDeepStrictEqual(await readJson(fs, target), value.payload))
          throw new Error("批准事件未绑定当前payload");
      } catch (error) {
        errors.push(`批准事件无效：${(error as Error).message}`);
      }
    }
  }
  return errors;
}
export async function consumeExecutionApproval(
  fs: ProjectFS,
  value: ObjectData,
): Promise<ObjectData> {
  const a = value.approval_ref;
  if (!object(a) || !text(a.path))
    throw new Error("Missing approval reference");
  return approval.consumeEvent(
    fs,
    await readJson(fs, a.path),
    String(value.recipient),
  );
}
export async function executeHandoff(
  fs: ProjectFS,
  value: unknown,
): Promise<string[]> {
  return fs.transaction(async (tx) => {
    const errors = await validateHandoff(value, { forExecution: true, fs: tx });
    if (
      !errors.length &&
      object(value) &&
      ["creative_brief", "consultant_brief", "chapter_situation"].includes(
        String(value.kind),
      )
    )
      await consumeExecutionApproval(tx, value);
    return errors;
  });
}

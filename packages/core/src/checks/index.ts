import bundle from "../../assets/upstream-bundle.json" with { type: "json" };
import type { ProjectFS } from "../fs/project-fs.ts";
import { AUDIT_KEYS, readEntries, validateAudit } from "../ledgers/index.ts";
import { type Registry, validateRegistry } from "../registry/index.ts";
import {
  chars,
  keysEqual,
  type ObjectData,
  object,
  readJson,
  readText,
} from "../runtime.ts";

export const REQUIRED_FILES = [
  "AGENTS.md",
  "项目/项目章程.md",
  "人物/主角档案.md",
  "世界/世界总表.md",
  "世界/当前态势.md",
  "表现/项目声音.md",
  "治理/资源注册表.json",
  "治理/审计账本.jsonl",
  "治理/文学问题账本.jsonl",
];
export const REQUIRED_ACTIVE_IDS = [
  "xiangmu-luyou-guize",
  "xiangmu-zhangcheng",
  "zhujue-dangan",
  "zhujue-pov-jingtou",
  "shijie-zongbiao",
  "shijie-dangqian-taishi",
  "gushi-dangqian-hu",
  "biaoxian-xiangmu-shengyin",
  "xiaoyan-yingsheding",
].sort();
const placeholders = ["待用户确认", "待项目初始化", "待批准材料"];
const section = (value: string, heading: string) =>
  value.includes(`## ${heading}`)
    ? ((value.split(`## ${heading}`)[1] ?? "").split("\n## ")[0]?.trim() ?? "")
    : "";
export async function projectReadiness(
  fs: ProjectFS,
): Promise<{ ready: boolean; status: string; errors: string[] }> {
  const errors: string[] = [];
  for (const p of REQUIRED_FILES)
    if (!(await fs.exists(p))) errors.push(`缺少必需文件：${p}`);
  for (const p of REQUIRED_FILES)
    if (p.endsWith(".md") && (await fs.exists(p))) {
      const content = await readText(fs, p);
      if (placeholders.some((v) => content.includes(v)))
        errors.push(`必需资料仍含初始化占位：${p}`);
    }
  if (await fs.exists("人物/主角档案.md")) {
    const content = await readText(fs, "人物/主角档案.md");
    for (const h of ["客观存在模型", "内在组织模型", "叙述接口模型"]) {
      const body = section(content, h);
      if (chars(body) < 40 || body.includes("待用户确认"))
        errors.push(`主角档案未完成：${h}`);
    }
  }
  if (await fs.exists("世界/世界总表.md")) {
    const content = await readText(fs, "世界/世界总表.md");
    for (const h of ["时代与空间", "物质与技术边界", "系统索引"])
      if (chars(section(content, h)) < 20) errors.push(`世界总表未完成：${h}`);
  }
  try {
    const { data, errors: registryErrors } = await validateRegistry(fs);
    errors.push(...registryErrors);
    for (const id of REQUIRED_ACTIVE_IDS) {
      const item = data.resources.find((x) => x.id === id);
      if (
        !item ||
        item.status !== "active" ||
        item.approval.status !== "approved"
      )
        errors.push(`必需资源尚未批准并激活：${id}`);
    }
    const systems = data.resources.filter(
      (x) =>
        x.type === "world" &&
        x.path.startsWith("世界/系统/") &&
        x.status === "active" &&
        x.approval.status === "approved",
    );
    if (!systems.length) errors.push("至少需要一个已批准并激活的正式世界系统");
    for (const item of systems) {
      const content = await readText(fs, item.path);
      if (placeholders.some((v) => content.includes(v)))
        errors.push(`世界系统仍含初始化占位：${item.id}`);
    }
    if (
      !data.resources.some(
        (x) => x.path === "表现/项目声音.md" && x.status === "active",
      )
    )
      errors.push("项目声音尚未批准并激活");
  } catch (error) {
    errors.push((error as Error).message);
  }
  return {
    ready: !errors.length,
    status: errors.length ? "blocked" : "ready",
    errors,
  };
}
export const CHECK_NAMES = Object.keys(bundle.closure);
export async function closureAudit(
  fs: ProjectFS,
  p: string,
  id: string | null = null,
  version: string | null = null,
  review: ObjectData | null = null,
): Promise<ObjectData> {
  const content = await readText(fs, p);
  const findings: ObjectData[] = [];
  for (const [category, patterns] of Object.entries(bundle.closure))
    for (const spec of patterns) {
      const matches = [
        ...content.matchAll(new RegExp(spec.pattern, `${spec.flags}g`)),
      ].map((m) => m[0]);
      if (matches.length)
        findings.push({
          category,
          count: matches.length,
          samples: matches.slice(0, 3),
        });
    }
  const density = content
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:[-*+]\s+|\d+[.、)])/.test(line)).length;
  if (density > 12)
    findings.push({
      category: "semantic_density",
      count: density,
      samples: ["结构化条目过密"],
    });
  const hash = await fs.sha256(p);
  const fullPath = fs.displayPath(p);
  const manualValid =
    review !== null &&
    keysEqual(review, [
      "resource_id",
      "resource_path",
      "resource_version",
      "resource_sha256",
      "reviewed_by",
      "checks",
    ]) &&
    review.resource_id === id &&
    review.resource_path === fullPath &&
    review.resource_version === version &&
    review.resource_sha256 === hash &&
    ["user", "biaoxian-shejishi"].includes(String(review.reviewed_by)) &&
    object(review.checks) &&
    keysEqual(review.checks, CHECK_NAMES) &&
    Object.values(review.checks).every((v) => v === "pass");
  const pass = !findings.length && manualValid;
  return {
    path: fullPath,
    sha256: hash,
    resource_id: id,
    resource_version: version,
    manual_review: review,
    pass,
    decision: pass ? "candidate_allowed" : "remain_proposed",
    findings,
  };
}
export function projectionErrors(content: string): string[] {
  const errors = bundle.contamination
    .filter((spec) => new RegExp(spec.pattern, spec.flags).test(content))
    .map((spec) => spec.label);
  if ([...content.matchAll(/^\s*(?:\d+[.)、]|[-*+]\s+)\s*\S+/gm)].length >= 3)
    errors.push("numbered or bulleted beat-sheet form");
  if (chars(content.trim()) < 80)
    errors.push("projection is too short to establish a narrative field");
  if (chars(content) > 2200)
    errors.push("generation field exceeds the 如文5.0 ceiling");
  return [...new Set(errors)];
}
export const candidateProseErrors = (content: string) =>
  bundle.silent.some((spec) =>
    new RegExp(spec.pattern, spec.flags).test(content),
  )
    ? ["候选正文出现治理、来源或履约元语言"]
    : [];
export async function governanceCheck(
  fs: ProjectFS,
): Promise<{ valid: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let registry: Registry;
  try {
    const result = await validateRegistry(fs);
    registry = result.data;
    errors.push(...result.errors);
  } catch (error) {
    return { valid: false, errors: [(error as Error).message], warnings };
  }
  const manifests = (await fs.list("authoring-ruwen-v5/manifests")).filter(
    (p) =>
      /^[^/]+\.json$/.test(p.slice("authoring-ruwen-v5/manifests/".length)),
  );
  for (const p of manifests) {
    let value: ObjectData;
    const name = p.split("/").at(-1);
    try {
      value = await readJson(fs, p);
    } catch (error) {
      errors.push(`manifest无效：${name}: ${(error as Error).message}`);
      continue;
    }
    for (const field of [
      "project_voice",
      "pov_lens",
      "relationship_lens",
      "expression_resource",
    ]) {
      const source = value[field];
      if (source == null) continue;
      if (
        typeof source !== "string" ||
        ["研究/", "治理/", "校验/", "世界/", "故事/"].some((prefix) =>
          source.startsWith(prefix),
        )
      ) {
        errors.push(`${name}.${field}越权：${String(source)}`);
        continue;
      }
      const item = registry.resources.find((x) => x.path === source);
      if (!item || item.status !== "active" || item.allow_author !== true)
        errors.push(`${name}.${field}引用未激活资源：${source}`);
    }
  }
  try {
    const entries = await readEntries(fs, "治理/审计账本.jsonl");
    for (const [i, entry] of entries.entries()) {
      if (!keysEqual(entry, ["time", ...AUDIT_KEYS])) {
        errors.push(`审计账本第${i + 1}行字段无效`);
        continue;
      }
      const { time: _time, ...event } = entry;
      errors.push(
        ...validateAudit(event).map((e) => `审计账本第${i + 1}行：${e}`),
      );
    }
  } catch (error) {
    errors.push((error as Error).message);
  }
  if (await fs.exists("治理/文学问题账本.jsonl"))
    for (const p of manifests)
      if ((await readText(fs, p)).includes("文学问题账本"))
        errors.push(`文学问题账本污染作者manifest：${p.split("/").at(-1)}`);
  const inactive = registry.resources
    .filter((x) => ["superseded", "retired"].includes(x.status))
    .map((x) => x.id);
  if (inactive.length) warnings.push(`已失效资源：${inactive.join(", ")}`);
  return { valid: !errors.length, errors, warnings };
}

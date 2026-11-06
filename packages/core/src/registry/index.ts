import * as approval from "../approval/index.ts";
import type { ProjectFS } from "../fs/project-fs.ts";
import {
  CoreError,
  keysEqual,
  type ObjectData,
  object,
  readJson,
  requireFile,
  text,
  utcNow,
  writeJson,
} from "../runtime.ts";

export const REGISTRY = "治理/资源注册表.json";
export const SCOPE_KEYS = [
  "project",
  "volumes",
  "arcs",
  "chapters",
  "scene_types",
  "povs",
];
const plurals = {
  volumes: "volume",
  arcs: "arc",
  chapters: "chapter",
  scene_types: "scene_type",
  povs: "pov",
};
export const TRANSITIONS: Record<string, string[]> = {
  proposed: ["candidate", "retired"],
  candidate: ["active", "retired"],
  active: ["superseded", "retired"],
  superseded: [],
  retired: [],
};
const typePaths: Record<string, string[]> = {
  evidence: ["研究/"],
  character: ["人物/"],
  world: ["世界/"],
  story: ["故事/"],
  expression: ["表现/"],
  validation: ["校验/"],
  governance: ["项目/", "治理/", "AGENTS.md"],
};
export type Resource = ObjectData & {
  id: string;
  path: string;
  type: string;
  status: string;
  owner: string;
  version: string;
  scope: ObjectData;
  approval: ObjectData;
  readers: string[];
  allow_author: boolean;
  source_sha256: string;
  supersedes: string | null;
};
export type Registry = ObjectData & { resources: Resource[] };
export async function readRegistry(fs: ProjectFS): Promise<Registry> {
  let data: ObjectData;
  try {
    data = await readJson(fs, REGISTRY);
  } catch (error) {
    throw new CoreError(`无法读取资源注册表：${(error as Error).message}`);
  }
  if (!Array.isArray(data.resources))
    throw new CoreError("资源注册表必须包含resources数组");
  return data as Registry;
}
export function validateScope(scope: unknown): string[] {
  if (!object(scope)) return ["scope必须是对象"];
  const errors: string[] = [];
  const extra = Object.keys(scope)
    .filter((k) => !SCOPE_KEYS.includes(k))
    .sort();
  if (extra.length) errors.push(`scope含未知字段：${extra.join(", ")}`);
  if (scope.project != null && !text(scope.project))
    errors.push("scope.project必须是文本或null");
  for (const key of Object.keys(plurals)) {
    const value = scope[key];
    if (
      value != null &&
      (!Array.isArray(value) || !value.every((v) => text(v) && v))
    )
      errors.push(`scope.${key}必须是非空文本数组或null`);
  }
  return errors;
}
export const authorPathAllowed = (p: string) =>
  p === "表现/项目声音.md" ||
  ["表现/能力/", "人物/POV镜头/", "人物/关系镜头/"].some((prefix) =>
    p.startsWith(prefix),
  );
export function scopeMatches(scope: ObjectData, query: ObjectData): boolean {
  if (scope.project != null && scope.project !== query.project) return false;
  return Object.entries(plurals).every(
    ([plural, singular]) =>
      scope[plural] == null ||
      (Array.isArray(scope[plural]) &&
        scope[plural].includes(query[singular] ?? null)),
  );
}
export const specificity = (scope: ObjectData) =>
  SCOPE_KEYS.filter((key) => scope[key] != null).length;
export function scopesOverlap(left: ObjectData, right: ObjectData): boolean {
  if (
    left.project != null &&
    right.project != null &&
    left.project !== right.project
  )
    return false;
  return Object.keys(plurals).every(
    (k) =>
      left[k] == null ||
      right[k] == null ||
      (Array.isArray(left[k]) &&
        Array.isArray(right[k]) &&
        left[k].some((v) => (right[k] as unknown[]).includes(v))),
  );
}
export async function validateClosureEvidence(
  fs: ProjectFS,
  resource: ObjectData,
  evidence: ObjectData,
): Promise<string[]> {
  const errors: string[] = [];
  try {
    const p = await requireFile(fs, evidence.closure_audit_path);
    if (evidence.closure_audit_sha256 !== (await fs.sha256(p)))
      errors.push("closure_audit_sha256不匹配");
    const audit = await readJson(fs, p);
    const resourcePath = await requireFile(fs, resource.path);
    if (audit.pass !== true) errors.push("闭合审计未通过");
    if (
      audit.resource_id !== resource.id ||
      audit.resource_version !== resource.version
    )
      errors.push("闭合审计未绑定资源ID或版本");
    if (
      audit.sha256 !== resource.source_sha256 ||
      !text(audit.path) ||
      fs.path(audit.path) !== resourcePath
    )
      errors.push("闭合审计未绑定当前资源路径与哈希");
    if (
      !object(audit.manual_review) ||
      audit.manual_review.resource_sha256 !== resource.source_sha256
    )
      errors.push("闭合审计缺少绑定当前资源的人工六项复核");
  } catch (error) {
    errors.push(`闭合审计证据无效：${(error as Error).message}`);
  }
  return errors;
}
export async function validateTrialEvidence(
  fs: ProjectFS,
  resource: ObjectData,
  evidence: ObjectData,
): Promise<string[]> {
  const errors: string[] = [];
  try {
    const p = await requireFile(fs, evidence.trial_report_path);
    if (evidence.trial_report_sha256 !== (await fs.sha256(p)))
      errors.push("trial_report_sha256不匹配");
    const report = await readJson(fs, p);
    if (
      !keysEqual(report, [
        "resource_id",
        "resource_path",
        "resource_version",
        "resource_sha256",
        "output_path",
        "output_sha256",
        "user_accepted",
        "canonical",
      ])
    )
      errors.push("试写报告字段无效");
    if (
      report.resource_id !== resource.id ||
      report.resource_path !== resource.path ||
      report.resource_version !== resource.version ||
      report.resource_sha256 !== resource.source_sha256
    )
      errors.push("试写报告未绑定当前资源");
    if (report.user_accepted !== true || report.canonical !== false)
      errors.push("试写不是已接受的非正典文本");
    const output = await requireFile(fs, report.output_path);
    if (report.output_sha256 !== (await fs.sha256(output)))
      errors.push("试写产物哈希不匹配");
  } catch (error) {
    errors.push(`试写证据无效：${(error as Error).message}`);
  }
  return errors;
}
export async function validateRegistry(
  fs: ProjectFS,
  checkHashes = true,
): Promise<{ data: Registry; errors: string[] }> {
  const data = await readRegistry(fs);
  const errors: string[] = [];
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  if (data.schema_version !== "1.0")
    errors.push(`不支持的注册表schema：${JSON.stringify(data.schema_version)}`);
  for (const [index, value] of data.resources.entries()) {
    const label = `resources[${index}]`;
    if (!object(value)) {
      errors.push(`${label}必须是对象`);
      continue;
    }
    const item = value as Resource;
    const rid = item.id;
    if (!text(rid) || !rid) errors.push(`${label}.id无效`);
    else if (ids.has(rid)) errors.push(`重复资源ID：${rid}`);
    else ids.add(rid);
    const name = rid || label;
    if (!text(item.type) || !Object.hasOwn(typePaths, item.type))
      errors.push(`${name}的type无效`);
    if (!text(item.status) || !Object.hasOwn(TRANSITIONS, item.status))
      errors.push(`${name}的status无效`);
    for (const key of ["owner", "version"])
      if (!text(item[key]) || !item[key]) errors.push(`${name}.${key}无效`);
    errors.push(...validateScope(item.scope).map((e) => `${name}: ${e}`));
    if (
      !Array.isArray(item.readers) ||
      !item.readers.every((v) => text(v) && v)
    )
      errors.push(`${name}.readers无效`);
    if (typeof item.allow_author !== "boolean")
      errors.push(`${name}.allow_author必须是布尔值`);
    try {
      const p = await requireFile(fs, item.path);
      const previous = paths.get(p);
      if (previous) errors.push(`同一路径被多个资源拥有：${previous}, ${rid}`);
      else paths.set(p, String(rid));
      if (item.allow_author && !authorPathAllowed(p))
        errors.push(`${rid}越权允许小说作者读取：${p}`);
      if (
        !(
          Object.hasOwn(typePaths, item.type)
            ? (typePaths[item.type] ?? [])
            : []
        ).some((prefix) => p === prefix || p.startsWith(prefix))
      )
        errors.push(`${rid}的资源类型与目录职责不一致：${p}`);
      if (
        checkHashes &&
        (!text(item.source_sha256) ||
          item.source_sha256 !== (await fs.sha256(p)))
      )
        errors.push(`${rid}的来源哈希不匹配`);
    } catch (error) {
      errors.push(`${name}: ${(error as Error).message}`);
    }
    const a = item.approval;
    if (
      !object(a) ||
      !text(a.status) ||
      !["unapproved", "approved"].includes(a.status)
    )
      errors.push(`${name}.approval无效`);
    if (item.status === "active" && object(a)) {
      if (a.status !== "approved") errors.push(`${name}未批准却处于active`);
      try {
        const p = await requireFile(fs, a.approval_event_path);
        if (a.approval_event_sha256 !== (await fs.sha256(p)))
          throw new CoreError("批准事件哈希不匹配");
        const event = await readJson(fs, p);
        const resourcePath = await requireFile(fs, item.path);
        await approval.validateEvent(
          fs,
          event,
          item.type === "expression"
            ? "expression_activate"
            : "resource_activate",
          resourcePath,
          undefined,
          true,
        );
        if (!(await approval.eventIsCommitted(fs, String(event.id))))
          throw new CoreError("active资源批准事件尚未消费");
      } catch (error) {
        errors.push(
          `${name}: active资源批准事件无效：${(error as Error).message}`,
        );
      }
    }
    if (
      item.type === "expression" &&
      ["candidate", "active"].includes(item.status) &&
      object(a)
    ) {
      errors.push(
        ...(await validateClosureEvidence(fs, item, a)).map(
          (e) => `${name}: ${e}`,
        ),
      );
      if (item.status === "active")
        errors.push(
          ...(await validateTrialEvidence(fs, item, a)).map(
            (e) => `${name}: ${e}`,
          ),
        );
    }
    if (item.supersedes != null && !text(item.supersedes))
      errors.push(`${name}.supersedes必须是资源ID或null`);
  }
  const byId = new Map(
    data.resources.filter((x) => object(x) && text(x.id)).map((x) => [x.id, x]),
  );
  for (const item of byId.values()) {
    if (!text(item.supersedes)) continue;
    if (!ids.has(item.supersedes))
      errors.push(`${item.id}引用不存在的supersedes：${item.supersedes}`);
    const target = byId.get(item.supersedes);
    if (target && target.type !== item.type)
      errors.push(`${item.id}不能替代不同职责资源${item.supersedes}`);
    const visited = new Set([item.id]);
    let cursor = target;
    while (cursor && text(cursor.supersedes)) {
      if (visited.has(cursor.supersedes)) {
        errors.push(`supersedes形成循环：${item.id}`);
        break;
      }
      visited.add(cursor.supersedes);
      cursor = byId.get(cursor.supersedes);
    }
  }
  const abilities = [...byId.values()].filter(
    (x) =>
      x.status === "active" && text(x.path) && x.path.startsWith("表现/能力/"),
  );
  for (const [i, left] of abilities.entries())
    for (const right of abilities.slice(i + 1))
      if (
        object(left.scope) &&
        object(right.scope) &&
        scopesOverlap(left.scope, right.scope)
      )
        errors.push(`active表现能力作用域冲突：${left.id} 与 ${right.id}`);
  return { data, errors };
}
export async function select(
  fs: ProjectFS,
  query: ObjectData,
  authorOnly = false,
): Promise<Resource[]> {
  const { data, errors } = await validateRegistry(fs);
  if (errors.length) throw new CoreError(errors.join("；"));
  const values = data.resources.filter(
    (x) =>
      x.status === "active" &&
      (!authorOnly || x.allow_author) &&
      scopeMatches(x.scope, query),
  );
  values.sort(
    (a, b) =>
      specificity(b.scope) - specificity(a.scope) ||
      (a.type < b.type
        ? -1
        : a.type > b.type
          ? 1
          : a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : 0),
  );
  if (authorOnly) {
    const expressions = values.filter((x) => x.path.startsWith("表现/能力/"));
    if (expressions.length > 1)
      throw new CoreError(
        `当前作用域同时命中多份表现能力：${expressions.map((x) => x.id).join(", ")}`,
      );
  }
  return values;
}
export interface TransitionOptions {
  approved?: boolean;
  approvalEvent?: string;
  closureAudit?: string;
  trialReport?: string;
}
export async function transition(
  fs: ProjectFS,
  id: string,
  status: string,
  options: TransitionOptions = {},
): Promise<Resource> {
  return fs.transaction(async (tx) => {
    const { data, errors } = await validateRegistry(tx);
    if (errors.length) throw new CoreError(errors.join("；"));
    if (!Object.hasOwn(TRANSITIONS, status))
      throw new CoreError(`未知状态：${status}`);
    const resource = data.resources.find((x) => x.id === id);
    if (!resource) throw new CoreError(`资源不存在：${id}`);
    if (!TRANSITIONS[resource.status]?.includes(status))
      throw new CoreError(`不允许的状态转换：${resource.status} -> ${status}`);
    let event: ObjectData | undefined;
    const eventRef: ObjectData = {};
    const evidence: ObjectData = {};
    if (status === "active") {
      if (!options.approved || !options.approvalEvent)
        throw new CoreError("激活资源必须显式确认用户批准并提供独立批准事件");
      const p = await requireFile(tx, options.approvalEvent);
      event = await readJson(tx, p);
      await approval.validateEvent(
        tx,
        event,
        resource.type === "expression"
          ? "expression_activate"
          : "resource_activate",
        resource.path,
      );
      eventRef.approval_event_path = p;
      eventRef.approval_event_sha256 = await tx.sha256(p);
    }
    if (
      ["candidate", "active"].includes(status) &&
      resource.type === "expression"
    ) {
      if (
        !options.closureAudit ||
        (status === "active" && !options.trialReport)
      )
        throw new CoreError(
          "表现资源进入candidate需要闭合审计；激活还需要非正典试写报告",
        );
      evidence.closure_audit_path = await requireFile(tx, options.closureAudit);
      evidence.closure_audit_sha256 = await tx.sha256(
        String(evidence.closure_audit_path),
      );
      const closureErrors = await validateClosureEvidence(
        tx,
        resource,
        evidence,
      );
      if (closureErrors.length) throw new CoreError(closureErrors.join("；"));
      if (status === "active") {
        evidence.trial_report_path = await requireFile(tx, options.trialReport);
        evidence.trial_report_sha256 = await tx.sha256(
          String(evidence.trial_report_path),
        );
        const trialErrors = await validateTrialEvidence(tx, resource, evidence);
        if (trialErrors.length) throw new CoreError(trialErrors.join("；"));
      }
    }
    if (status === "active" && text(resource.supersedes)) {
      const replaced = data.resources.find((x) => x.id === resource.supersedes);
      if (!replaced || !scopesOverlap(resource.scope, replaced.scope))
        throw new CoreError("替代资源与被替代资源的作用域不相交");
      replaced.status = "superseded";
    }
    resource.status = status;
    if (options.approved)
      resource.approval = {
        status: "approved",
        approved_at: utcNow(),
        approved_by: "user",
        ...evidence,
        ...eventRef,
      };
    else if (Object.keys(evidence).length)
      resource.approval = {
        status: "unapproved",
        approved_at: null,
        approved_by: null,
        ...evidence,
      };
    const reservation = event
      ? await approval.reserveEvent(tx, event, "xiangmu-zhiliyuan")
      : null;
    await writeJson(tx, REGISTRY, data, true);
    if (reservation) await approval.commitReservation(tx, reservation);
    return resource;
  });
}
export async function refreshHash(
  fs: ProjectFS,
  id: string,
  approved: boolean,
): Promise<Resource> {
  if (!approved)
    throw new CoreError("刷新资源哈希需要显式确认用户已批准本次资料修改");
  return fs.transaction(async (tx) => {
    const { data, errors } = await validateRegistry(tx, false);
    if (errors.length) throw new CoreError(errors.join("；"));
    const resource = data.resources.find((x) => x.id === id);
    if (!resource) throw new CoreError(`资源不存在：${id}`);
    if (resource.type === "expression" && resource.status === "active")
      throw new CoreError(
        "active表现资源不能直接刷新；请建立新版本并重新审计、试写和激活",
      );
    resource.source_sha256 = await tx.sha256(resource.path);
    if (resource.type === "expression" && resource.status === "candidate")
      resource.status = "proposed";
    resource.approval = {
      status: "approved",
      approved_at: utcNow(),
      approved_by: "user",
    };
    await writeJson(tx, REGISTRY, data, true);
    return resource;
  });
}

import path from "node:path";
import bundle from "../../assets/upstream-bundle.json" with { type: "json" };
import { projectionErrors } from "../checks/index.ts";
import type { ProjectFS } from "../fs/project-fs.ts";
import { scopeMatches, validateRegistry } from "../registry/index.ts";
import {
  CoreError,
  chars,
  keysEqual,
  type ObjectData,
  object,
  pyJson,
  readJson,
  readText,
  ref,
  requireFile,
  tail,
  text,
  under,
  utcNow,
  writeJson,
  writeText,
} from "../runtime.ts";
import {
  CONTEXT_SCOPE_KEYS,
  computeStatus,
  loadState,
  requireSnapshotSource,
  saveState,
  validateGeneratedMeta,
} from "../state/index.ts";

const REQUIRED = [
  "projection",
  "project_voice",
  "pov_lens",
  "relationship_lens",
  "expression_resource",
  "approved_prose_tail",
  "context_scope",
  "output",
];
const OPTIONAL = ["maximum_context_characters", "user_authored_text"];
export const FORBIDDEN_ROLE_STEMS = [
  "research",
  "report",
  "reports",
  "diagnostic",
  "diagnostics",
  "notes",
  "untitled",
  "document",
];
function exactKeys(value: ObjectData, allowed: string[], label: string): void {
  const missing = allowed.filter((k) => !Object.hasOwn(value, k)).sort();
  const extra = Object.keys(value)
    .filter((k) => !allowed.includes(k))
    .sort();
  if (missing.length)
    throw new CoreError(`${label} is missing fields: ${missing.join(", ")}`);
  if (extra.length)
    throw new CoreError(`${label} has unsupported fields: ${extra.join(", ")}`);
}
export function loadAuthorCore(): string {
  const start = "<!-- AUTHOR_CORE_START -->";
  const end = "<!-- AUTHOR_CORE_END -->";
  if (
    bundle.soul.split(start).length !== 2 ||
    bundle.soul.split(end).length !== 2
  )
    throw new CoreError("章节写作创作核心必须且只能包含一组小说作者核心标记");
  const core = bundle.soul.split(start)[1]?.split(end)[0]?.trim() ?? "";
  if (!core) throw new CoreError("小说作者核心 is empty");
  if (chars(core) > 420)
    throw new CoreError(
      `小说作者核心 exceeds the 如文5.0 budget (${chars(core)} > 420)`,
    );
  return core;
}
function authorRelative(
  fs: ProjectFS,
  state: ObjectData,
  value: string,
): string {
  const p = fs.path(value);
  if (state.rewrite_snapshot == null) return p;
  const snapshot = state.rewrite_snapshot;
  if (!object(snapshot) || !text(snapshot.root))
    throw new CoreError("rewrite snapshot state is invalid");
  const prefix = fs.path(snapshot.root);
  under(
    p,
    prefix,
    `Author source must live under the registered snapshot: ${fs.displayPath(p)}`,
  );
  return p.slice(prefix.length + 1);
}
async function requireAuthorSource(
  fs: ProjectFS,
  state: ObjectData,
  p: string,
  role: string,
  query: ObjectData,
): Promise<void> {
  const relative = authorRelative(fs, state, p);
  if (role === "project_voice") {
    if (relative !== "表现/项目声音.md")
      throw new CoreError("project_voice must be exactly 表现/项目声音.md");
  } else {
    const dirs: Record<string, string> = {
      pov_lens: "人物/POV镜头",
      relationship_lens: "人物/关系镜头",
      expression_resource: "表现/能力",
    };
    const expected = dirs[role];
    if (!expected)
      throw new CoreError(`Unsupported author source role: ${role}`);
    under(relative, expected, `${role} must live under ${expected}/`);
    const child = relative.slice(expected.length + 1);
    const parts = path.posix.parse(child);
    if (child.includes("/") || parts.ext.toLowerCase() !== ".md")
      throw new CoreError(
        `${role} must be a direct Markdown child of ${expected}/`,
      );
    if (FORBIDDEN_ROLE_STEMS.includes(parts.name.toLowerCase()))
      throw new CoreError(
        `${role} uses a non-role source filename: ${parts.base}`,
      );
  }
  const { data, errors } = await validateRegistry(fs, false);
  if (errors.length)
    throw new CoreError(`资源注册表无效：${errors.join("; ")}`);
  const matches = data.resources.filter((x) => x.path === relative);
  const resource = matches[0];
  if (matches.length !== 1 || !resource)
    throw new CoreError(`${role}必须由资源注册表中的唯一资源拥有：${relative}`);
  if (resource.status !== "active" || resource.allow_author !== true)
    throw new CoreError(`${role}尚未激活或无权进入小说作者资料包：${relative}`);
  if (resource.source_sha256 !== (await fs.sha256(p)))
    throw new CoreError(`${role}与资源注册表哈希不一致：${relative}`);
  if (!scopeMatches(resource.scope, query))
    throw new CoreError(`${role}不适用于当前章节作用域：${relative}`);
  const expectedType = ["project_voice", "expression_resource"].includes(role)
    ? "expression"
    : "character";
  if (resource.type !== expectedType)
    throw new CoreError(`${role}的资源类型错误：${resource.type}`);
  requireSnapshotSource(fs, state, p, role);
}
export async function compilePacket(
  fs: ProjectFS,
  manifestValue: string,
): Promise<{ output: string; warnings: string[] }> {
  return fs.transaction(async (tx) => {
    const state = await loadState(tx);
    const status = await computeStatus(tx, state);
    if (status.pending_approved_candidate)
      throw new CoreError("Approved candidate promotion is pending");
    if (status.pending_consolidation)
      throw new CoreError("Memory consolidation is pending");
    if (status.projection_stale)
      throw new CoreError(
        `Narrative projection is stale: ${(status.projection_reasons as string[]).join("; ")}`,
      );
    const manifestPath = await requireFile(tx, manifestValue);
    under(
      manifestPath,
      "authoring-ruwen-v5/manifests",
      "Author manifest must live under authoring-ruwen-v5/manifests",
    );
    const manifest = await readJson(tx, manifestPath);
    const missing = REQUIRED.filter((k) => !Object.hasOwn(manifest, k)).sort();
    const extra = Object.keys(manifest)
      .filter((k) => ![...REQUIRED, ...OPTIONAL].includes(k))
      .sort();
    if (missing.length)
      throw new CoreError(`manifest is missing fields: ${missing.join(", ")}`);
    if (extra.length)
      throw new CoreError(
        `manifest has unsupported fields: ${extra.join(", ")}`,
      );
    const scope = manifest.context_scope;
    if (!object(scope) || !keysEqual(scope, CONTEXT_SCOPE_KEYS))
      throw new CoreError(
        "context_scope必须完整包含project、volume、arc、chapter、scene_type、pov",
      );
    if (Object.values(scope).some((v) => v !== null && !text(v)))
      throw new CoreError("context_scope的值必须是文本或null");
    const maximum = manifest.maximum_context_characters ?? 8000;
    if (
      typeof maximum !== "number" ||
      !Number.isInteger(maximum) ||
      maximum < 3000 ||
      maximum > 8000
    )
      throw new CoreError(
        "maximum_context_characters must be an integer between 3000 and 8000",
      );
    const projection = await requireFile(tx, manifest.projection);
    under(
      projection,
      "authoring-ruwen-v5/projections",
      "Projection source must live under authoring-ruwen-v5/projections",
    );
    const active = state.active_projection;
    if (!object(active) || active.path !== projection)
      throw new CoreError(
        "Manifest projection is not the registered active projection",
      );
    const sorted = (v: ObjectData) =>
      Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, v[k]]),
      );
    if (
      !object(active.context_scope) ||
      pyJson(sorted(active.context_scope)) !== pyJson(sorted(scope))
    )
      throw new CoreError(
        "manifest context_scope与已注册章节情境的可信作用域不一致",
      );
    const rolePaths: [string, string][] = [["projection", projection]];
    const voice = await requireFile(tx, manifest.project_voice);
    const pov = await requireFile(tx, manifest.pov_lens);
    await requireAuthorSource(tx, state, voice, "project_voice", scope);
    await requireAuthorSource(tx, state, pov, "pov_lens", scope);
    rolePaths.push(["project_voice", voice], ["pov_lens", pov]);
    const optional: [string, string][] = [];
    for (const role of ["relationship_lens", "expression_resource"])
      if (manifest[role] != null) {
        const p = await requireFile(tx, manifest[role]);
        await requireAuthorSource(tx, state, p, role, scope);
        optional.push([role, p]);
        rolePaths.push([role, p]);
      }
    let exact: string | null = null;
    if (manifest.user_authored_text != null) {
      const value = manifest.user_authored_text;
      if (!object(value))
        throw new CoreError("user_authored_text must be null or an object");
      exactKeys(value, ["path", "confirmed_verbatim"], "user_authored_text");
      if (value.confirmed_verbatim !== true)
        throw new CoreError(
          "user_authored_text requires confirmed_verbatim=true",
        );
      exact = await requireFile(tx, value.path);
      under(
        exact,
        "authoring-ruwen-v5/exact-text",
        "user_authored_text must live under authoring-ruwen-v5/exact-text",
      );
    }
    const projectionText = (await readText(tx, projection)).trim();
    const errors = projectionErrors(projectionText);
    if (errors.length)
      throw new CoreError(`Projection contamination: ${errors.join("; ")}`);
    if (chars(projectionText) > 2200)
      throw new CoreError(
        `generation field exceeds its 如文5.0 ceiling (${chars(projectionText)} > 2200)`,
      );
    const sections: [string, string][] = [];
    const sources: ObjectData[] = [];
    const addSource = async (
      role: string,
      p: string,
      selection: ObjectData = { kind: "full" },
    ) => {
      sources.push({ role, ...(await ref(tx, p)), selection });
    };
    await addSource("author_manifest", manifestPath);
    if (manifest.approved_prose_tail != null) {
      const value = manifest.approved_prose_tail;
      if (!object(value))
        throw new CoreError("approved_prose_tail must be null or an object");
      exactKeys(value, ["path", "chars"], "approved_prose_tail");
      const length = value.chars;
      if (
        typeof length !== "number" ||
        !Number.isInteger(length) ||
        length < 200 ||
        length > 2400
      )
        throw new CoreError(
          "approved_prose_tail.chars must be between 200 and 2400",
        );
      const prose = await requireFile(tx, value.path);
      requireSnapshotSource(tx, state, prose, "approved_prose_tail");
      const approved = state.last_approved_prose;
      if (!object(approved) || approved.path !== prose)
        throw new CoreError(
          "approved_prose_tail must use the state's last approved prose",
        );
      if (approved.sha256 !== (await tx.sha256(prose)))
        throw new CoreError("approved_prose_tail hash no longer matches state");
      sections.push(["最近批准正文", tail(await readText(tx, prose), length)]);
      await addSource("approved_prose_tail", prose, {
        kind: "tail",
        chars: length,
      });
      rolePaths.push(["approved_prose_tail", prose]);
    }
    if (exact) rolePaths.push(["user_authored_text", exact]);
    const seen = new Map<string, string>();
    for (const [role, p] of rolePaths) {
      const previous = seen.get(p);
      if (previous)
        throw new CoreError(
          `One file cannot serve multiple packet roles: ${previous}, ${role}`,
        );
      seen.set(p, role);
    }
    sections.push(["当前章节情境", projectionText]);
    await addSource("projection", projection);
    if (exact) {
      const content = await readText(tx, exact);
      if (!content.trim())
        throw new CoreError(
          `Empty user_authored_text: ${tx.displayPath(exact)}`,
        );
      if (chars(content) > 600)
        throw new CoreError(
          `user_authored_text exceeds its 如文5.0 ceiling (${chars(content)} > 600)`,
        );
      sections.push([
        "用户要求逐字保留的文本",
        content.replace(/[\r\n]+$/, ""),
      ]);
      await addSource("user_authored_text", exact);
    }
    for (const [role, p, title, maximum] of [
      ["project_voice", voice, "项目声音", 1200],
      ["pov_lens", pov, "当前POV镜头", 900],
    ] as const) {
      const content = (await readText(tx, p)).trim();
      if (!content) throw new CoreError(`Empty ${role}: ${tx.displayPath(p)}`);
      if (chars(content) > maximum)
        throw new CoreError(
          `${role} exceeds its 如文5.0 ceiling (${chars(content)} > ${maximum})`,
        );
      sections.push([title, content]);
      await addSource(role, p);
    }
    for (const [role, p] of optional) {
      const content = (await readText(tx, p)).trim();
      if (!content) throw new CoreError(`Empty ${role}: ${tx.displayPath(p)}`);
      if (chars(content) > 900)
        throw new CoreError(
          `${role} exceeds its 如文5.0 ceiling (${chars(content)} > 900)`,
        );
      sections.push([
        role === "relationship_lens" ? "必要关系镜头" : "当前表现能力",
        content,
      ]);
      await addSource(role, p);
    }
    const body = [
      "# 如文·小说作者资料包",
      "",
      "# 创作核心",
      "",
      loadAuthorCore(),
      "",
      "只在这个有限处境中写一个被人物实际经历的章节。保留明确事件与锁定顺序，但不要把情境句当作逐项覆盖清单；不要浏览项目记忆。",
      "",
    ];
    for (const [title, content] of sections)
      body.push(`# ${title}`, "", content, "");
    const rendered = `${body.join("\n").trimEnd()}\n`;
    if (chars(rendered) > maximum)
      throw new CoreError(
        `packet exceeds maximum context (${chars(rendered)} > ${maximum}); remove inactive or duplicated input`,
      );
    if (!text(manifest.output)) throw new CoreError("output must be text");
    const output = tx.path(manifest.output);
    under(
      output,
      "authoring-ruwen-v5/packets",
      "Packet output must live under authoring-ruwen-v5/packets",
    );
    await writeText(tx, output, rendered);
    const metaPath = `${output}.meta.json`;
    const warnings: string[] = [];
    const meta = {
      schema_version: "2.0",
      generated_at: utcNow(),
      artifact: await ref(tx, output),
      manifest: await ref(tx, manifestPath),
      sources,
      warnings,
    };
    await writeJson(tx, metaPath, meta);
    state.active_packet = { ...(await ref(tx, output)), meta: metaPath };
    state.stale = { projection: false, packet: false };
    await saveState(tx, state);
    return { output, warnings };
  });
}
export async function checkPacket(
  fs: ProjectFS,
  value: string,
): Promise<{ valid: boolean; reasons: string[] }> {
  const p = await requireFile(fs, value);
  if (!p.startsWith("authoring-ruwen-v5/packets/"))
    return {
      valid: false,
      reasons: ["packet不在authoring-ruwen-v5/packets目录"],
    };
  const state = await loadState(fs);
  const active = state.active_packet;
  if (!object(active) || active.path !== p)
    return { valid: false, reasons: ["packet不是项目状态登记的active packet"] };
  if (active.sha256 !== (await fs.sha256(p)))
    return { valid: false, reasons: ["active packet哈希不匹配"] };
  const metaPath = `${p}.meta.json`;
  if (!(await fs.exists(metaPath)))
    return { valid: false, reasons: ["packet metadata is missing"] };
  const meta = await readJson(fs, metaPath);
  const reasons: string[] = [];
  if (
    !keysEqual(meta, [
      "schema_version",
      "generated_at",
      "artifact",
      "manifest",
      "sources",
      "warnings",
    ])
  )
    reasons.push("packet metadata字段不完整或含额外字段");
  if (meta.schema_version !== "2.0")
    reasons.push("packet metadata schema版本不匹配");
  if (active.meta !== metaPath)
    reasons.push("packet metadata不是active packet登记版本");
  reasons.push(...(await validateGeneratedMeta(fs, active, "packet")));
  if (!object(meta.manifest)) reasons.push("packet metadata缺少manifest引用");
  else {
    try {
      const manifest = await requireFile(fs, meta.manifest.path);
      if (meta.manifest.sha256 !== (await fs.sha256(manifest)))
        reasons.push("packet manifest哈希不匹配");
    } catch (error) {
      reasons.push((error as Error).message);
    }
  }
  if (!Array.isArray(meta.sources)) reasons.push("packet sources无效");
  else {
    const roles = meta.sources.filter(object).map((s) => s.role);
    const required = [
      "author_manifest",
      "projection",
      "project_voice",
      "pov_lens",
    ];
    const allowed = [
      ...required,
      "relationship_lens",
      "expression_resource",
      "approved_prose_tail",
      "user_authored_text",
    ];
    for (const source of meta.sources) {
      if (
        !object(source) ||
        !keysEqual(source, ["role", "path", "sha256", "selection"])
      ) {
        reasons.push("packet来源引用字段无效");
        continue;
      }
      if (!object(source.selection)) reasons.push("packet来源选择说明无效");
    }
    if (!required.every((role) => roles.includes(role)))
      reasons.push("packet缺少必需来源角色");
    if (
      new Set(roles).size !== roles.length ||
      roles.some((role) => !text(role) || !allowed.includes(role))
    )
      reasons.push("packet来源角色重复或越权");
  }
  const status = await computeStatus(fs, state);
  if (status.projection_stale) reasons.push("projection is stale");
  if (status.pending_consolidation)
    reasons.push("memory consolidation is pending");
  if (status.pending_approved_candidate)
    reasons.push("approved candidate promotion is pending");
  return { valid: !reasons.length, reasons };
}

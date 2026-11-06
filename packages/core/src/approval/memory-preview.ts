import type { ProjectFS } from "../fs/project-fs.ts";
import { appendAudit } from "../ledgers/index.ts";
import { REGISTRY, readRegistry, validateRegistry } from "../registry/index.ts";
import {
  CoreError,
  digest,
  keysEqual,
  type ObjectData,
  object,
  pyJson,
  readJson,
  text,
  utcNow,
  writeJson,
} from "../runtime.ts";
import { loadState, reconcileState } from "../state/index.ts";
import { consumeEvent, validateEvent } from "./index.ts";

export interface MemoryPatch {
  path: string;
  new_content: string;
}
/** Only existing approved canon resources; expressions require a separate version/evidence workflow. */
export async function createMemoryPreview(
  fs: ProjectFS,
  id: string,
  patches: MemoryPatch[],
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) throw new CoreError("预览ID无效");
  return fs.transaction(async (tx) => {
    const state = await loadState(tx);
    if (!state.pending_consolidation)
      throw new CoreError("当前没有待处理的记忆合并");
    const { data, errors } = await validateRegistry(tx);
    if (errors.length) throw new CoreError(errors.join("；"));
    const selected: ObjectData[] = [];
    const seen = new Set<string>();
    for (const patch of patches) {
      const p = tx.path(patch.path);
      if (seen.has(p)) throw new CoreError("预览包含重复路径");
      seen.add(p);
      const resource = data.resources.find((r) => r.path === p);
      if (
        !resource ||
        resource.status !== "active" ||
        !["character", "world", "story"].includes(resource.type)
      )
        throw new CoreError("记忆预览只能修改已激活的人物、世界或故事资源");
      if (!text(patch.new_content)) throw new CoreError("预览正文必须是文本");
      selected.push({
        path: p,
        base_sha256: await tx.sha256(p),
        new_content: patch.new_content,
      });
    }
    const output = `authoring-ruwen-v5/reports/${id}.json`;
    const preview = {
      schema_version: "1.0",
      kind: "memory_change_preview",
      generated_at: utcNow(),
      registry_sha256: await tx.sha256(REGISTRY),
      patches: selected,
    };
    await tx.createExclusive(output, `${pyJson(preview)}\n`);
    return output;
  });
}
export async function commitMemoryPreview(
  fs: ProjectFS,
  previewPath: string,
  eventPath: string,
): Promise<ObjectData> {
  return fs.transaction(async (tx) => {
    const p = tx.path(previewPath);
    if (!p.startsWith("authoring-ruwen-v5/reports/"))
      throw new CoreError("记忆预览路径无效");
    const eventP = tx.path(eventPath);
    if (!eventP.startsWith("治理/审批/"))
      throw new CoreError("批准事件路径无效");
    const state = await loadState(tx);
    if (!state.pending_consolidation)
      throw new CoreError("当前没有待处理的记忆合并");
    const event = await readJson(tx, eventP);
    await validateEvent(tx, event, "memory_commit", p, state);
    const preview = await readJson(tx, p);
    if (
      !keysEqual(preview, [
        "schema_version",
        "kind",
        "generated_at",
        "registry_sha256",
        "patches",
      ]) ||
      preview.schema_version !== "1.0" ||
      preview.kind !== "memory_change_preview" ||
      !Array.isArray(preview.patches)
    )
      throw new CoreError("记忆预览结构无效");
    if (preview.registry_sha256 !== (await tx.sha256(REGISTRY)))
      throw new CoreError("预览已陈旧：资源注册表已变化");
    const data = await readRegistry(tx);
    const seen = new Set<string>();
    const changed: string[] = [];
    for (const patch of preview.patches) {
      if (
        !object(patch) ||
        !keysEqual(patch, ["path", "base_sha256", "new_content"]) ||
        !text(patch.path) ||
        !text(patch.new_content)
      )
        throw new CoreError("记忆补丁结构无效");
      const target = tx.path(patch.path);
      const resource = data.resources.find((r) => r.path === target);
      if (seen.has(target)) throw new CoreError("预览包含重复路径");
      seen.add(target);
      if (
        !resource ||
        resource.status !== "active" ||
        !["character", "world", "story"].includes(resource.type)
      )
        throw new CoreError("记忆预览只能修改已激活的人物、世界或故事资源");
      if (patch.base_sha256 !== (await tx.sha256(target)))
        throw new CoreError(`预览已陈旧：${target}`);
      await tx.write(target, patch.new_content);
      resource.source_sha256 = await tx.sha256(target);
      // The approved preview binds every new byte. Derived activation events preserve upstream registry semantics.
      const derivedId = `memory-${digest(`${event.id}\0${resource.id}\0${resource.source_sha256}`).slice(0, 40)}`;
      const derivedPath = `治理/审批/${derivedId}.json`;
      const derived = {
        schema_version: "1.0",
        id: derivedId,
        action: "resource_activate",
        target_path: target,
        target_sha256: resource.source_sha256,
        approved_at: event.approved_at ?? null,
        approved_by: "user",
        consumed: false,
      };
      await tx.createExclusive(derivedPath, `${pyJson(derived)}\n`);
      await consumeEvent(tx, derived, "jiyi-weihuyuan");
      resource.approval = {
        status: "approved",
        approved_at: event.approved_at ?? null,
        approved_by: "user",
        approval_event_path: derivedPath,
        approval_event_sha256: await tx.sha256(derivedPath),
      };
      changed.push(resource.id);
    }
    await writeJson(tx, REGISTRY, data, true);
    const validation = await validateRegistry(tx);
    if (validation.errors.length)
      throw new CoreError(validation.errors.join("；"));
    await appendAudit(tx, {
      role: "jiyi-weihuyuan",
      resource_ids: changed,
      change: "memory_preview_committed",
      scope: {
        project: data.resources[0]?.scope.project ?? null,
        volume: null,
        arc: null,
        chapter: null,
      },
      conflict_category: null,
      approval_status: "approved",
      result: "committed",
    });
    return reconcileState(tx, {
      memoryPreview: p,
      memoryApprovalEvent: eventP,
    });
  });
}

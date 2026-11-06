import bundle from "../../assets/upstream-bundle.json" with { type: "json" };
import type { ProjectFS } from "../fs/project-fs.ts";
import { REGISTRY, readRegistry } from "../registry/index.ts";
import {
  CoreError,
  type ObjectData,
  object,
  pyJson,
  readJson,
  utcNow,
  writeJson,
  writeText,
} from "../runtime.ts";

export async function initProject(
  fs: ProjectFS,
  projectId: string,
): Promise<ObjectData> {
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(projectId))
    throw new CoreError("project-id只允许3-64位小写字母、数字和连字符", 1);
  return fs.transaction(async (tx) => {
    if ((await tx.list()).length)
      throw new CoreError("目标目录必须不存在或为空；不会覆盖已有项目", 1);
    for (const [p, bytes] of Object.entries(bundle.files))
      await tx.createExclusive(p, Buffer.from(bytes, "base64"));
    const registry = await readRegistry(tx);
    for (const item of registry.resources) {
      item.scope.project = projectId;
      item.source_sha256 = await tx.sha256(item.path);
    }
    await writeJson(tx, REGISTRY, registry);
    const manifestPath = "authoring-ruwen-v5/manifests/author-manifest.json";
    const manifest = await readJson(tx, manifestPath);
    if (object(manifest.context_scope))
      manifest.context_scope.project = projectId;
    await writeJson(tx, manifestPath, manifest);
    const event = {
      time: utcNow(),
      role: "xiangmu-zhiliyuan",
      resource_ids: [],
      change: "project_scaffold_created",
      scope: { project: projectId, volume: null, arc: null, chapter: null },
      conflict_category: null,
      approval_status: "not_required",
      result: "candidate_scaffold",
    };
    await writeText(tx, "治理/审计账本.jsonl", `${pyJson(event, false)}\n`);
    return {
      status: "created",
      project_root: tx.root,
      project_id: projectId,
      readiness: "blocked_until_user_approval",
    };
  });
}

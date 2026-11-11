import type { Data, RoleResult } from "@ruwen/agents";
import { editingPolicy } from "@ruwen/agents";
import { applySectionEdits, approval, registry } from "@ruwen/core";
import { previewBytesHash } from "./backend.ts";
import type {
  IdeationContextScope,
  IdeationCoreApprovalRef,
  IdeationFilePatch,
  IdeationFilePreview,
  IdeationResourceMetadata,
  IdeationResourceRef,
  IdeationResourceScope,
} from "./contract.ts";
import { ideationDigest, ideationFail } from "./sessions.ts";
import type { IdeationTransaction } from "./store.ts";

const reserved = [
  "治理/审批/",
  "治理/交接/",
  "治理/构思决定/",
  "治理/资源注册表.json",
  "治理/审计账本.jsonl",
  "治理/文学问题账本.jsonl",
  "authoring-ruwen-v5/",
  "chapters/",
];
export const resourceMetadata = (
  r: registry.Resource,
): IdeationResourceMetadata =>
  ({
    id: r.id,
    path: r.path,
    sha256: r.source_sha256,
    type: r.type,
    status: r.status,
    scope: r.scope,
    owner: r.owner,
    version: r.version,
    readers: r.readers,
    allowAuthor: r.allow_author,
    supersedes: r.supersedes,
  }) as unknown as IdeationResourceMetadata;
export const registryScope = (
  s: IdeationContextScope,
): IdeationResourceScope => ({
  project: s.project,
  volumes: s.volume ? [s.volume] : null,
  arcs: s.arc ? [s.arc] : null,
  chapters: s.chapter ? [s.chapter] : null,
  scene_types: s.scene_type ? [s.scene_type] : null,
  povs: s.pov ? [s.pov] : null,
});
export function writablePath(
  tx: IdeationTransaction,
  path: string,
  type: string,
) {
  if (
    tx.path(path) !== path ||
    reserved.some((prefix) => path === prefix || path.startsWith(prefix))
  )
    ideationFail("READERS_DENIED");
  const prefix: Record<string, string[]> = {
    governance: ["项目/", "治理/", "AGENTS.md"],
    character: ["人物/"],
    world: ["世界/"],
    story: ["故事/"],
    evidence: ["研究/"],
    validation: ["校验/"],
    expression: ["表现/"],
  };
  if (!prefix[type]?.some((root) => path === root || path.startsWith(root)))
    ideationFail("READERS_DENIED");
}
export async function buildFilePatches(
  tx: IdeationTransaction,
  result: RoleResult,
  role: string,
  scope: IdeationContextScope,
) {
  const output = result.output as Data,
    data = await registry.readRegistry(tx);
  const patches: IdeationFilePatch[] = [],
    changes: {
      resourceId: IdeationResourceMetadata["id"];
      before: IdeationResourceMetadata | null;
      after: IdeationResourceMetadata;
    }[] = [];
  const seen = new Set<string>();
  for (const patch of (Array.isArray(output.patches)
    ? output.patches
    : []) as Data[]) {
    const path = String(patch.path),
      resource = data.resources.find((r) => r.path === path);
    if (
      !resource ||
      resource.type === "expression" ||
      resource.scope.project !== scope.project ||
      resource.status !== "active" ||
      !resource.readers.includes(role)
    )
      ideationFail("READERS_DENIED");
    writablePath(tx, path, resource.type);
    if (role === "gushi-gousishi" && resource.type !== "story")
      ideationFail("READERS_DENIED");
    if (
      !result.readResources.some(
        (read) =>
          read.id === resource.id &&
          read.path === path &&
          read.sha256 === patch.base_sha256,
      )
    )
      ideationFail("READERS_DENIED");
    if (seen.has(path)) ideationFail("OUTPUT_BLOCKED");
    seen.add(path);
    const before = await tx.readText(path);
    if ((await tx.sha256(path)) !== patch.base_sha256)
      ideationFail("RESOURCE_STALE");
    const sections = patch.sections as unknown as {
      heading: string;
      replacement: string;
    }[];
    let after: string;
    try {
      after = applySectionEdits(before, sections, editingPolicy());
    } catch {
      ideationFail("OUTPUT_BLOCKED");
    }
    const metadata = resourceMetadata(resource),
      afterHash = previewBytesHash(after);
    patches.push({
      kind: "sections",
      resource: metadata,
      sections,
      beforeText: before,
      afterText: after,
      afterSha256: afterHash,
    } as unknown as IdeationFilePatch);
    changes.push({
      resourceId: metadata.id,
      before: metadata,
      after: { ...metadata, sha256: afterHash as never },
    });
  }
  const names = new Set(
    (await tx.list()).map((p) => p.normalize("NFC").toLowerCase()),
  );
  for (const file of (Array.isArray(output.new_files)
    ? output.new_files
    : []) as Data[]) {
    const id = String(file.resource_id),
      path = String(file.path),
      type = String(file.type),
      content = String(file.content);
    if (
      !/^[a-z0-9-]{2,64}$/.test(id) ||
      data.resources.some((r) => r.id === id) ||
      changes.some((r) => r.resourceId === id)
    )
      ideationFail("OUTPUT_BLOCKED");
    if (role === "gushi-gousishi" && type !== "story")
      ideationFail("READERS_DENIED");
    writablePath(tx, path, type);
    const key = path.normalize("NFC").toLowerCase();
    if (names.has(key)) ideationFail("RESOURCE_STALE");
    names.add(key);
    let readers = [
      "chuangyi-xietiaoyuan",
      "xiangmu-zhiliyuan",
      "gushi-gousishi",
      "waibu-zhishi-guwen",
      "zhangjie-qingjing-bianyiyuan",
      "biaoxian-shejishi",
    ];
    if (type === "evidence")
      readers = [
        "xiangmu-zhiliyuan",
        "waibu-zhishi-guwen",
        "biaoxian-shejishi",
      ];
    const after = {
      id,
      path,
      sha256: previewBytesHash(content),
      type,
      status: "active",
      scope: registryScope(scope),
      owner: role,
      version: "0.1.0",
      readers,
      allowAuthor: false,
      supersedes: null,
    } as unknown as IdeationResourceMetadata;
    patches.push({
      kind: "create",
      resourceId: after.id,
      path: after.path,
      baseSha256: null,
      content,
      afterSha256: after.sha256,
    } as unknown as IdeationFilePatch);
    changes.push({ resourceId: after.id, before: null, after });
  }
  return { patches, registryChanges: changes };
}
export async function commitFilePatches(
  tx: IdeationTransaction,
  preview: IdeationFilePreview,
  decisionId: string,
) {
  const data = await registry.readRegistry(tx),
    coreApprovals: IdeationCoreApprovalRef[] = [],
    files: IdeationResourceRef[] = [];
  for (const patch of preview.patches) {
    const id = patch.kind === "create" ? patch.resourceId : patch.resource.id;
    const change = preview.registryChanges.find((c) => c.resourceId === id);
    if (!change) ideationFail("PREVIEW_STALE");
    const existing = data.resources.find((r) => r.id === id);
    const after = change.after;
    writablePath(tx, after.path, after.type);
    if (
      after.type === "expression" ||
      (after.allowAuthor !== change.before?.allowAuthor &&
        change.before !== null)
    )
      ideationFail("PREVIEW_STALE");
    if (existing) {
      if (
        !change.before ||
        ideationDigest(resourceMetadata(existing)) !==
          ideationDigest(change.before)
      )
        ideationFail("PREVIEW_STALE");
    } else if (change.before !== null) ideationFail("PREVIEW_STALE");
    if (patch.kind === "sections") {
      if (
        !existing ||
        (await tx.sha256(existing.path)) !== patch.resource.sha256
      )
        ideationFail("PREVIEW_STALE");
      const actual = applySectionEdits(
        await tx.readText(existing.path),
        patch.sections,
        editingPolicy(),
      );
      if (
        actual !== patch.afterText ||
        previewBytesHash(actual) !== patch.afterSha256
      )
        ideationFail("PREVIEW_STALE");
      await tx.write(existing.path, actual);
    } else {
      if (
        existing ||
        (await tx.exists(patch.path)) ||
        previewBytesHash(patch.content) !== patch.afterSha256
      )
        ideationFail("PREVIEW_STALE");
      await tx.createExclusive(patch.path, patch.content);
    }
    if ((await tx.sha256(after.path)) !== after.sha256)
      ideationFail("PREVIEW_STALE");
    const eventId = `ideation-${previewBytesHash(`${decisionId}:${id}`).slice(0, 40)}`;
    const created = await approval.createEvent(
        tx,
        eventId,
        "resource_activate",
        after.path,
        true,
      ),
      path = String(created.event),
      event = JSON.parse(await tx.readText(path));
    await approval.consumeEvent(tx, event, preview.role);
    const updated = {
      id: after.id,
      path: after.path,
      type: after.type,
      status: after.status,
      scope: after.scope,
      owner: after.owner,
      version: after.version,
      readers: [...after.readers],
      allow_author: after.allowAuthor,
      source_sha256: after.sha256,
      supersedes: after.supersedes,
      approval: {
        status: "approved",
        approved_at: event.approved_at,
        approved_by: "user",
        approval_event_path: path,
        approval_event_sha256: await tx.sha256(path),
      },
    } as unknown as registry.Resource;
    if (existing) Object.assign(existing, updated);
    else data.resources.push(updated);
    coreApprovals.push({
      id: eventId,
      path,
      sha256: await tx.sha256(path),
      action: "resource_activate",
      target: { path: after.path, sha256: after.sha256 },
    } as unknown as IdeationCoreApprovalRef);
    files.push(after);
  }
  if (preview.registryChanges.length !== preview.patches.length)
    ideationFail("PREVIEW_STALE");
  if (preview.patches.length)
    await tx.write(registry.REGISTRY, `${JSON.stringify(data, null, 2)}\n`);
  if ((await registry.validateRegistry(tx)).errors.length)
    ideationFail("PRECONDITION_FAILED");
  return {
    coreApprovals,
    committedFiles: files.map((f) => ({ path: f.path, sha256: f.sha256 })),
    projectionRegistered: false,
  };
}

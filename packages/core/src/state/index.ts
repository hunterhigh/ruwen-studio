import path from "node:path";
import * as approval from "../approval/index.ts";
import {
  candidateProseErrors,
  projectionErrors,
  projectReadiness,
} from "../checks/index.ts";
import type { ProjectFS } from "../fs/project-fs.ts";
import { validateRegistry } from "../registry/index.ts";
import {
  CoreError,
  directoryHash,
  keysEqual,
  type ObjectData,
  object,
  readJson,
  readText,
  ref,
  requireFile,
  text,
  timestampToken,
  under,
  utcNow,
  writeJson,
} from "../runtime.ts";

export const STATE = "authoring-ruwen-v5/state.json";
export const CONTEXT_SCOPE_KEYS = [
  "project",
  "volume",
  "arc",
  "chapter",
  "scene_type",
  "pov",
];
export type State = ObjectData & {
  tracked_sources: ObjectData[];
  approval_history: ObjectData[];
  consumed_approval_ids: string[];
};
export async function loadState(fs: ProjectFS): Promise<State> {
  if (!(await fs.exists(STATE)))
    throw new CoreError(
      `如文5.0 project is not initialized: ${fs.displayPath(STATE)}`,
    );
  const state = await readJson(fs, STATE);
  if (state.schema_version === "1.2")
    throw new CoreError(
      "State schema 1.2 requires explicit migration; run migrate-state --project-root <project> --check, then --apply",
    );
  if (state.schema_version !== "2.0")
    throw new CoreError(
      `Unsupported state schema: ${JSON.stringify(state.schema_version)}`,
    );
  if (
    !Object.hasOwn(state, "pending_approved_candidate") ||
    !Array.isArray(state.approval_history)
  )
    throw new CoreError(
      "State schema 2.0 is missing approval lifecycle fields",
    );
  if (!Array.isArray(state.consumed_approval_ids))
    throw new CoreError("State schema 2.0 is missing consumed approval IDs");
  return state as State;
}
export const saveState = async (fs: ProjectFS, state: ObjectData) => {
  state.updated_at = utcNow();
  await writeJson(fs, STATE, state);
};
export async function sourceRefs(
  fs: ProjectFS,
  values: string[],
): Promise<ObjectData[]> {
  const refs: ObjectData[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const index = value.indexOf("=");
    if (index < 0) throw new CoreError(`Source must use role=path: ${value}`);
    const role = value.slice(0, index).trim();
    const p = value.slice(index + 1).trim();
    if (!/^[a-z][a-z0-9_-]*$/.test(role))
      throw new CoreError(`Invalid source role: ${role}`);
    if (!p) throw new CoreError(`Empty path for source role: ${role}`);
    if (seen.has(role)) throw new CoreError(`Duplicate source role: ${role}`);
    seen.add(role);
    refs.push({ role, ...(await ref(fs, await requireFile(fs, p))) });
  }
  return refs;
}
async function requireRegisteredInputs(
  fs: ProjectFS,
  outline: string,
  sources: ObjectData[],
): Promise<void> {
  const { data, errors } = await validateRegistry(fs);
  if (errors.length)
    throw new CoreError(`资源注册表无效：${errors.join("; ")}`);
  const requireInput = async (p: string, types: string[], label: string) => {
    const relative = await requireFile(fs, p);
    const item = data.resources.find((x) => x.path === relative);
    if (!item) throw new CoreError(`${label}未在资源注册表中登记：${relative}`);
    if (!types.includes(item.type))
      throw new CoreError(`${label}职责越权：${relative}`);
    if (item.status !== "active" || item.approval.status !== "approved")
      throw new CoreError(`${label}尚未批准并激活：${relative}`);
    if (item.source_sha256 !== (await fs.sha256(relative)))
      throw new CoreError(`${label}哈希与注册表不一致：${relative}`);
  };
  await requireInput(outline, ["story"], "active outline");
  for (const s of sources)
    await requireInput(
      String(s.path),
      ["character", "world", "story"],
      `tracked source ${s.role}`,
    );
}
export function validateContextScope(
  value: unknown,
  chapter: string,
): ObjectData {
  if (!object(value) || !keysEqual(value, CONTEXT_SCOPE_KEYS))
    throw new CoreError(
      "context scope必须完整包含project、volume、arc、chapter、scene_type、pov",
    );
  if (Object.values(value).some((x) => x !== null && !text(x)))
    throw new CoreError("context scope的值必须是文本或null");
  if (value.chapter !== chapter)
    throw new CoreError("context scope.chapter必须与注册章节一致");
  return { ...value };
}
async function rewriteSnapshot(
  fs: ProjectFS,
  cutoff?: string,
  value?: string,
): Promise<ObjectData | null> {
  if (Boolean(cutoff) !== Boolean(value))
    throw new CoreError(
      "rewrite-cutoff and snapshot-root must be provided together",
    );
  if (!cutoff || !value) return null;
  const root = fs.path(value);
  under(
    root,
    "authoring-ruwen-v5/snapshots",
    "rewrite snapshot must live under authoring-ruwen-v5/snapshots",
  );
  if (!(await fs.list(root)).length)
    throw new CoreError(`Missing directory: ${fs.displayPath(root)}`);
  return { cutoff, root, sha256: await directoryHash(fs, root) };
}
export function requireSnapshotSource(
  fs: ProjectFS,
  state: ObjectData,
  p: string,
  role: string,
): void {
  if (state.rewrite_snapshot == null) return;
  const snapshot = state.rewrite_snapshot;
  if (!object(snapshot) || !text(snapshot.root))
    throw new CoreError("rewrite snapshot state is invalid");
  under(
    fs.path(p),
    fs.path(snapshot.root),
    `rewrite source ${role} must live under the registered snapshot: ${fs.displayPath(p)}`,
  );
}
export async function currentRefReason(
  fs: ProjectFS,
  value: ObjectData,
  label: string,
): Promise<string | null> {
  if (!text(value.path) || !text(value.sha256))
    return `invalid ${label} reference`;
  try {
    const p = await requireFile(fs, value.path);
    return (await fs.sha256(p)) !== value.sha256
      ? `changed ${label}: ${value.path}`
      : null;
  } catch (error) {
    return (error as Error).message;
  }
}
export async function baseSourceReasons(
  fs: ProjectFS,
  state: ObjectData,
): Promise<string[]> {
  const reasons: string[] = [];
  if (state.rewrite_snapshot != null) {
    const snapshot = state.rewrite_snapshot;
    if (!object(snapshot)) reasons.push("rewrite snapshot is invalid");
    else if (!text(snapshot.root) || !text(snapshot.sha256))
      reasons.push("rewrite snapshot reference is invalid");
    else {
      try {
        if (
          (await directoryHash(fs, fs.path(snapshot.root))) !== snapshot.sha256
        )
          reasons.push(`changed rewrite snapshot: ${snapshot.root}`);
      } catch (error) {
        reasons.push((error as Error).message);
      }
    }
  }
  if (!object(state.active_outline))
    reasons.push("active outline is not registered");
  else {
    const reason = await currentRefReason(fs, state.active_outline, "outline");
    if (reason) reasons.push(reason);
  }
  if (!Array.isArray(state.tracked_sources))
    reasons.push("tracked sources are invalid");
  else
    for (const value of state.tracked_sources) {
      if (!object(value)) reasons.push("invalid tracked source reference");
      else {
        const reason = await currentRefReason(
          fs,
          value,
          `source ${value.role ?? "source"}`,
        );
        if (reason) reasons.push(reason);
      }
    }
  if (state.last_approved_prose != null) {
    if (!object(state.last_approved_prose))
      reasons.push("last approved prose reference is invalid");
    else {
      const reason = await currentRefReason(
        fs,
        state.last_approved_prose,
        "last approved prose",
      );
      if (reason) reasons.push(reason);
    }
  }
  return reasons;
}
export async function validateGeneratedMeta(
  fs: ProjectFS,
  active: unknown,
  label: string,
): Promise<string[]> {
  if (!object(active)) return [`no active ${label}`];
  if (!text(active.meta)) return [`active ${label} has no metadata`];
  let meta: ObjectData;
  try {
    meta = await readJson(fs, await requireFile(fs, active.meta));
  } catch (error) {
    return [(error as Error).message];
  }
  const reasons: string[] = [];
  if (!object(meta.artifact))
    reasons.push(`invalid ${label} artifact metadata`);
  else {
    const reason = await currentRefReason(fs, meta.artifact, label);
    if (reason) reasons.push(reason);
  }
  if (!Array.isArray(meta.sources))
    reasons.push(`invalid ${label} source metadata`);
  else
    for (const s of meta.sources) {
      if (!object(s)) reasons.push(`invalid ${label} source reference`);
      else {
        const reason = await currentRefReason(
          fs,
          s,
          `${label} source ${s.role ?? "source"}`,
        );
        if (reason) reasons.push(reason);
      }
    }
  return reasons;
}
export async function computeStatus(
  fs: ProjectFS,
  state: ObjectData,
): Promise<ObjectData> {
  const sourceReasons = await baseSourceReasons(fs, state);
  const projectionReasons = [
    ...sourceReasons,
    ...(await validateGeneratedMeta(fs, state.active_projection, "projection")),
  ];
  const projectionStale = Boolean(projectionReasons.length);
  const packetReasons = [
    ...(projectionStale ? ["projection is stale"] : []),
    ...(await validateGeneratedMeta(fs, state.active_packet, "packet")),
  ];
  const pendingCandidate = state.pending_approved_candidate != null;
  const pendingConsolidation = Boolean(state.pending_consolidation);
  return {
    initialized: true,
    pending_approved_candidate: pendingCandidate,
    pending_consolidation: pendingConsolidation,
    projection_stale: projectionStale,
    packet_stale: Boolean(packetReasons.length),
    source_reasons: sourceReasons,
    projection_reasons: projectionReasons,
    packet_reasons: packetReasons,
    ready_to_compile:
      !sourceReasons.length &&
      !pendingCandidate &&
      !pendingConsolidation &&
      !projectionStale,
    ready_to_draft:
      !pendingCandidate &&
      !pendingConsolidation &&
      !projectionStale &&
      !packetReasons.length,
  };
}
export interface InitStateOptions {
  lastApproved?: string;
  rewriteCutoff?: string;
  snapshotRoot?: string;
}
export async function initState(
  fs: ProjectFS,
  outline: string,
  sources: string[] = [],
  options: InitStateOptions = {},
): Promise<State> {
  return fs.transaction(async (tx) => {
    if (await tx.exists(STATE))
      throw new CoreError(
        `如文5.0 project is already initialized: ${tx.displayPath(STATE)}`,
      );
    const readiness = await projectReadiness(tx);
    if (!readiness.ready)
      throw new CoreError(
        `项目尚未具备正式写作条件：${readiness.errors.join("; ")}`,
      );
    const outlinePath = await requireFile(tx, outline);
    const tracked = await sourceRefs(tx, sources);
    const snapshot = await rewriteSnapshot(
      tx,
      options.rewriteCutoff,
      options.snapshotRoot,
    );
    await requireRegisteredInputs(tx, outlinePath, tracked);
    const state: State = {
      schema_version: "2.0",
      created_at: utcNow(),
      updated_at: utcNow(),
      active_outline: await ref(tx, outlinePath),
      tracked_sources: tracked,
      last_approved_prose: options.lastApproved
        ? await ref(tx, await requireFile(tx, options.lastApproved))
        : null,
      pending_approved_candidate: null,
      approval_history: [],
      consumed_approval_ids: [],
      rewrite_snapshot: snapshot,
      active_projection: null,
      active_packet: null,
      pending_consolidation: false,
      stale: { projection: true, packet: true },
    };
    if (snapshot) {
      for (const source of tracked)
        requireSnapshotSource(
          tx,
          state,
          String(source.path),
          String(source.role),
        );
      if (!object(state.last_approved_prose))
        throw new CoreError(
          "rewrite snapshot mode requires last-approved prose",
        );
      requireSnapshotSource(
        tx,
        state,
        String(state.last_approved_prose.path),
        "last_approved_prose",
      );
    }
    await saveState(tx, state);
    return state;
  });
}
export async function registerProjection(
  fs: ProjectFS,
  value: string,
  chapter: string,
  contextScope: unknown,
): Promise<ObjectData> {
  return fs.transaction(async (tx) => {
    const state = await loadState(tx);
    const registry = await validateRegistry(tx);
    if (registry.errors.length)
      throw new CoreError(`资源治理检查失败：${registry.errors.join("; ")}`);
    if (state.pending_approved_candidate != null)
      throw new CoreError(
        "Cannot register a generation field while promotion is pending",
      );
    if (state.pending_consolidation)
      throw new CoreError(
        "Cannot register a generation field while consolidation is pending",
      );
    const reasons = await baseSourceReasons(tx, state);
    if (reasons.length)
      throw new CoreError(
        `State Reconcile changed sources first: ${reasons.join("; ")}`,
      );
    const p = await requireFile(tx, value);
    const scope = validateContextScope(contextScope, chapter);
    under(
      p,
      "authoring-ruwen-v5/projections",
      "Projection must live under authoring-ruwen-v5/projections",
    );
    const errors = projectionErrors(await readText(tx, p));
    if (errors.length)
      throw new CoreError(`Projection contamination: ${errors.join("; ")}`);
    const sources: ObjectData[] = [
      {
        role: "outline",
        ...(object(state.active_outline) ? state.active_outline : {}),
      },
      ...state.tracked_sources,
    ];
    if (object(state.last_approved_prose))
      sources.push({
        role: "last_approved_prose",
        ...state.last_approved_prose,
      });
    const metaPath = `${p}.meta.json`;
    const artifact = await ref(tx, p);
    const meta = {
      schema_version: "2.0",
      chapter,
      context_scope: scope,
      generated_at: utcNow(),
      artifact,
      sources,
    };
    await writeJson(tx, metaPath, meta);
    state.active_projection = {
      ...artifact,
      meta: metaPath,
      chapter,
      context_scope: scope,
    };
    state.active_packet = null;
    state.stale = { projection: false, packet: true };
    await saveState(tx, state);
    return meta;
  });
}
export async function recordApproved(
  fs: ProjectFS,
  proseValue: string,
  version: string,
  eventValue: string,
): Promise<State> {
  return fs.transaction(async (tx) => {
    const state = await loadState(tx);
    version = version.trim();
    if (!version) throw new CoreError("version must be non-empty");
    if (state.pending_approved_candidate != null)
      throw new CoreError("An approved candidate is already pending promotion");
    if (state.pending_consolidation)
      throw new CoreError(
        "Cannot approve another candidate while consolidation is pending",
      );
    const packet = state.active_packet;
    const reasons = await validateGeneratedMeta(tx, packet, "packet");
    const status = await computeStatus(tx, state);
    if (status.projection_stale) reasons.push("projection is stale");
    if (reasons.length || !object(packet))
      throw new CoreError(`Current packet is not valid: ${reasons.join("; ")}`);
    const prose = await requireFile(tx, proseValue);
    under(
      prose,
      "authoring-ruwen-v5/candidates",
      "Approved prose must live under authoring-ruwen-v5/candidates",
    );
    const errors = candidateProseErrors(await readText(tx, prose));
    if (errors.length)
      throw new CoreError(`候选正文未通过silent floor：${errors.join("; ")}`);
    const eventPath = await requireFile(tx, eventValue);
    under(eventPath, "治理/审批", "批准事件必须位于治理/审批/");
    const event = await readJson(tx, eventPath);
    try {
      await approval.validateEvent(
        tx,
        event,
        "candidate_approve",
        prose,
        state,
      );
    } catch (error) {
      throw new CoreError(`候选批准事件无效：${(error as Error).message}`);
    }
    const reservation = await approval.reserveEvent(
      tx,
      event,
      "jiyi-weihuyuan",
    );
    state.pending_approved_candidate = {
      ...(await ref(tx, prose)),
      version,
      approved_at: utcNow(),
      approval_event: await ref(tx, eventPath),
      source_packet: {
        path: packet.path ?? null,
        sha256: packet.sha256 ?? null,
        meta: packet.meta ?? null,
      },
    };
    state.consumed_approval_ids.push(String(event.id));
    state.active_projection = null;
    state.active_packet = null;
    state.stale = { projection: true, packet: true };
    await saveState(tx, state);
    await approval.commitReservation(tx, reservation);
    return state;
  });
}
export async function promoteApproved(
  fs: ProjectFS,
  targetValue: string,
  replaceExisting = false,
  expectedHash?: string,
): Promise<State> {
  return fs.transaction(async (tx) => {
    const state = await loadState(tx);
    const pending = state.pending_approved_candidate;
    if (!object(pending))
      throw new CoreError("No approved candidate is pending promotion");
    const reason = await currentRefReason(tx, pending, "approved candidate");
    if (reason) throw new CoreError(reason);
    const candidate = await requireFile(tx, pending.path);
    under(
      candidate,
      "authoring-ruwen-v5/candidates",
      "Approved candidate is outside authoring-ruwen-v5/candidates",
    );
    const target = tx.path(targetValue);
    if (!target.toLowerCase().endsWith(".md"))
      throw new CoreError("Formal chapter target must be a Markdown file");
    under(
      target,
      "chapters",
      "Formal chapter target must live under chapters/",
    );
    let archiveRef: ObjectData | null = null;
    let replacedRef: ObjectData | null = null;
    if (await tx.exists(target)) {
      if (!replaceExisting || !expectedHash)
        throw new CoreError(
          "Existing target requires --replace-existing and --expected-target-sha256",
        );
      const hash = await tx.sha256(target);
      if (hash.toLowerCase() !== expectedHash.trim().toLowerCase())
        throw new CoreError(
          `Target SHA-256 mismatch: expected ${expectedHash}, actual ${hash}`,
        );
      replacedRef = await ref(tx, target);
      const parts = path.posix.parse(target);
      const base = `${parts.name}-${timestampToken()}-${hash.slice(0, 12)}`;
      let archive = `authoring-ruwen-v5/snapshots/replacements/${base}${parts.ext}`;
      let i = 1;
      while (await tx.exists(archive))
        archive = `authoring-ruwen-v5/snapshots/replacements/${base}-${i++}${parts.ext}`;
      await tx.write(archive, await tx.read(target));
      archiveRef = await ref(tx, archive);
    } else if (replaceExisting || expectedHash)
      throw new CoreError(
        "Replacement flags require an existing formal target",
      );
    await tx.write(target, await tx.read(candidate));
    const formal = await ref(tx, target);
    const entry = {
      event: "approved_prose_promoted",
      version: pending.version ?? null,
      approved_at: pending.approved_at ?? null,
      promoted_at: utcNow(),
      candidate: { path: pending.path ?? null, sha256: pending.sha256 ?? null },
      formal_target: formal,
      source_packet: pending.source_packet ?? null,
      replaced_target: replacedRef,
      replacement_archive: archiveRef,
    };
    state.last_approved_prose = formal;
    state.approval_history.push(entry);
    state.pending_approved_candidate = null;
    state.pending_consolidation = true;
    state.active_projection = null;
    state.active_packet = null;
    state.stale = { projection: true, packet: true };
    await saveState(tx, state);
    return state;
  });
}
export interface ReconcileOptions {
  outline?: string;
  sources?: string[];
  memoryPreview?: string;
  memoryApprovalEvent?: string;
  rewriteCutoff?: string;
  snapshotRoot?: string;
  clearRewriteSnapshot?: boolean;
}
export async function reconcileState(
  fs: ProjectFS,
  options: ReconcileOptions = {},
): Promise<State> {
  return fs.transaction(async (tx) => {
    const state = await loadState(tx);
    if (state.pending_approved_candidate != null)
      throw new CoreError(
        "Promote the approved candidate before State Reconcile",
      );
    const outline = await requireFile(
      tx,
      options.outline ??
        (object(state.active_outline) ? state.active_outline.path : null),
    );
    if (
      options.clearRewriteSnapshot &&
      (options.rewriteCutoff != null || options.snapshotRoot != null)
    )
      throw new CoreError(
        "clear-rewrite-snapshot cannot be combined with rewrite-cutoff or snapshot-root",
      );
    if (options.clearRewriteSnapshot) state.rewrite_snapshot = null;
    else if (options.rewriteCutoff != null || options.snapshotRoot != null)
      state.rewrite_snapshot = await rewriteSnapshot(
        tx,
        options.rewriteCutoff,
        options.snapshotRoot,
      );
    const sources = options.sources?.length
      ? await sourceRefs(tx, options.sources)
      : await Promise.all(
          state.tracked_sources.map(async (item) => ({
            role: item.role ?? null,
            ...(await ref(tx, await requireFile(tx, item.path))),
          })),
        );
    await requireRegisteredInputs(tx, outline, sources);
    state.active_outline = await ref(tx, outline);
    state.tracked_sources = sources;
    if (state.rewrite_snapshot != null) {
      for (const s of sources)
        requireSnapshotSource(tx, state, String(s.path), String(s.role));
      if (!object(state.last_approved_prose))
        throw new CoreError(
          "rewrite snapshot mode requires last-approved prose",
        );
      requireSnapshotSource(
        tx,
        state,
        String(state.last_approved_prose.path),
        "last_approved_prose",
      );
    }
    let reservation: approval.Reservation | undefined;
    if (state.pending_consolidation) {
      if (!options.memoryPreview || !options.memoryApprovalEvent)
        throw new CoreError("记忆合并待处理：需要变更预览和独立用户批准事件");
      const preview = await requireFile(tx, options.memoryPreview);
      under(
        preview,
        "authoring-ruwen-v5/reports",
        "记忆变更预览必须位于authoring-ruwen-v5/reports/",
      );
      const p = await requireFile(tx, options.memoryApprovalEvent);
      under(p, "治理/审批", "批准事件必须位于治理/审批/");
      const event = await readJson(tx, p);
      try {
        await approval.validateEvent(
          tx,
          event,
          "memory_commit",
          preview,
          state,
        );
      } catch (error) {
        throw new CoreError(
          `记忆合并批准事件无效：${(error as Error).message}`,
        );
      }
      reservation = await approval.reserveEvent(tx, event, "jiyi-weihuyuan");
      state.consumed_approval_ids.push(String(event.id));
      state.approval_history.push({
        event: "memory_consolidation_approved",
        approved_at: event.approved_at ?? null,
        preview: await ref(tx, preview),
        approval_event: await ref(tx, p),
      });
      state.pending_consolidation = false;
    } else if (options.memoryPreview || options.memoryApprovalEvent)
      throw new CoreError("当前没有待处理的记忆合并");
    state.active_projection = null;
    state.active_packet = null;
    state.stale = { projection: true, packet: true };
    await saveState(tx, state);
    if (reservation) await approval.commitReservation(tx, reservation);
    return state;
  });
}
export async function migrationPreview(fs: ProjectFS): Promise<ObjectData> {
  const state = await readJson(fs, STATE);
  const version = state.schema_version;
  if (version === "2.0")
    return {
      status: "up-to-date",
      from_schema: "2.0",
      to_schema: "2.0",
      changes_required: false,
    };
  if (version !== "1.2")
    throw new CoreError(`Unsupported state schema: ${JSON.stringify(version)}`);
  const candidate =
    object(state.last_approved_prose) &&
    text(state.last_approved_prose.path) &&
    state.last_approved_prose.path.startsWith("authoring-ruwen-v5/candidates/");
  return {
    status: "migration-required",
    from_schema: "1.2",
    to_schema: "2.0",
    changes_required: true,
    backup_directory: "authoring-ruwen-v5/snapshots/state-migrations",
    legacy_import: Boolean(state.pending_consolidation) || candidate,
    legacy_reason: {
      pending_consolidation: Boolean(state.pending_consolidation),
      last_approved_prose_is_candidate: candidate,
    },
  };
}
export async function migrateState(
  fs: ProjectFS,
  apply = false,
): Promise<ObjectData> {
  return fs.transaction(async (tx) => {
    const preview = await migrationPreview(tx);
    if (!apply || !preview.changes_required) return preview;
    const state = await readJson(tx, STATE);
    const hash = await tx.sha256(STATE);
    const backup = `authoring-ruwen-v5/snapshots/state-migrations/state-1.2-${timestampToken()}-${hash.slice(0, 12)}.json`;
    await tx.write(backup, await tx.read(STATE));
    state.schema_version = "2.0";
    state.pending_approved_candidate = null;
    state.approval_history = [];
    state.consumed_approval_ids = [];
    if (preview.legacy_import) {
      const entry = {
        event: "legacy_import",
        imported_at: utcNow(),
        source_schema: "1.2",
        last_approved_prose: state.last_approved_prose ?? null,
        pending_consolidation: Boolean(state.pending_consolidation),
        note: "Preserved without inferring whether prose was candidate or formal.",
      };
      state.legacy_import = entry;
      state.approval_history.push(entry);
    }
    await saveState(tx, state);
    return {
      status: "migrated",
      from_schema: "1.2",
      to_schema: "2.0",
      backup,
      backup_sha256: hash,
      legacy_import: preview.legacy_import ?? false,
    };
  });
}

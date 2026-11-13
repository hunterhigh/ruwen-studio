import { createHash, randomUUID } from "node:crypto";
import {
  clearChapterExactText,
  ensureExactTextChapter,
} from "./ideation/exact-text.ts";

export type * from "./ideation/contract.ts";
export { withIdeationV1_2 } from "./ideation/service-v1-2.ts";
export {
  type IdeationSessionOptions,
  IdeationSessions,
} from "./ideation/sessions.ts";
export { ideationSse } from "./ideation/sse.ts";

import {
  type Data,
  editingPolicy,
  listAuthorizedResources,
  RoleAbortError,
  type RoleContext,
  RoleExecutionError,
  type RoleId,
  type RoleResult,
  readAuthorizedResource,
  runRole,
} from "@ruwen/agents";
import {
  applyEditorialEdits,
  applySectionEdits,
  approval,
  candidateProblems,
  checks,
  commitMemoryPreview,
  createMemoryPreview,
  type EditorialEdit,
  type ProjectFS,
  packet,
  publicRoleResult,
  type SectionEdit,
  state,
} from "@ruwen/core";

export const CHAPTER_ROLES = {
  author: "xiaoshuo-zuozhe",
  reader: "qinggan-duzhe",
  editor: "wenxue-bianji",
  plot: "qingjie-heyanyuan",
  reality: "xianshi-heyanyuan",
  memory: "jiyi-weihuyuan",
} as const;
export type RunStatus =
  | "REQUESTED"
  | "READINESS_OK"
  | "PACKET_COMPILED"
  | "AUTHOR_DONE"
  | "READER_DONE"
  | "EDITOR_DONE"
  | "PLOT_CHECKED"
  | "REALITY_CHECKED"
  | "AWAITING_CANDIDATE_APPROVAL"
  | "CANDIDATE_APPROVED"
  | "MEMORY_PREVIEW_READY"
  | "AWAITING_MEMORY_APPROVAL"
  | "MEMORY_COMMITTED"
  | "DONE"
  | "RETURNED"
  | "FAILED_PRECONDITION"
  | "FAILED"
  | "CANCELLED";
export class InterruptedRoleError extends RoleExecutionError {}
export interface ChapterRun {
  id: string;
  projectKey: string;
  chapter: string;
  target: string;
  status: RunStatus;
  paths: Record<string, string>;
  roles: Partial<
    Record<
      RoleId,
      { path: string; cost: number; promptSha256: string; model: string }
    >
  >;
  costTotal: number;
  events: { status: RunStatus; time: string }[];
  candidateSha256?: string;
  packetSha256?: string;
  memoryPreviewSha256?: string;
  targetBeforeSha256?: string;
  returnedTo?: string;
  returnReason?: string;
  error?: string;
  failedRole?: RoleId;
  requestSha256?: string;
  literaryProblemsRecorded?: boolean;
}
export interface ChapterRequest {
  simulation?: string;
  chapter: string | number;
  manifest?: string;
  target?: string;
  lockedEvents?: string[];
  lockedOrder?: string[];
}
export interface PipelineContext extends Omit<RoleContext, "fs"> {
  onProgress?: (run: ChapterRun) => void;
  runId?: string;
  deferMemory?: boolean;
  executeRole?: (
    id: RoleId,
    input: Data,
    ctx: RoleContext,
    run: ChapterRun,
  ) => Promise<RoleResult>;
  onCheckpoint?: (fs: ProjectFS, run: ChapterRun) => Promise<void>;
}
export interface UserApproval {
  confirmed: true;
  expectedSha256: string;
  expectedTargetSha256?: string;
}
const active = new Map<
  string,
  { control: AbortController; projectKey: string }
>();
const DIRECTORY = candidateProblems.RUN_DIRECTORY;
const NORMAL: Partial<Record<RunStatus, RunStatus[]>> = {
  REQUESTED: ["READINESS_OK", "FAILED_PRECONDITION"],
  READINESS_OK: ["PACKET_COMPILED"],
  PACKET_COMPILED: ["AUTHOR_DONE"],
  AUTHOR_DONE: ["READER_DONE"],
  READER_DONE: ["EDITOR_DONE"],
  EDITOR_DONE: ["PLOT_CHECKED", "RETURNED"],
  PLOT_CHECKED: ["REALITY_CHECKED", "RETURNED"],
  REALITY_CHECKED: ["AWAITING_CANDIDATE_APPROVAL", "RETURNED"],
  AWAITING_CANDIDATE_APPROVAL: ["CANDIDATE_APPROVED", "RETURNED"],
  CANDIDATE_APPROVED: ["MEMORY_PREVIEW_READY", "RETURNED"],
  MEMORY_PREVIEW_READY: ["AWAITING_MEMORY_APPROVAL"],
  AWAITING_MEMORY_APPROVAL: ["MEMORY_COMMITTED"],
  MEMORY_COMMITTED: ["DONE"],
};
const object = (v: unknown): v is Data =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const asData = (value: unknown): Data => {
  const plain: unknown = JSON.parse(JSON.stringify(value));
  if (!object(plain)) throw new Error("Expected object output");
  return plain;
};
const parse = async (fs: ProjectFS, p: string): Promise<Data> => {
  const value: unknown = JSON.parse(await fs.readText(p));
  if (!object(value)) throw new Error("Invalid JSON artifact");
  return value;
};
const write = (fs: ProjectFS, p: string, value: unknown) =>
  fs.write(p, `${JSON.stringify(value, null, 2)}\n`);
const text = async (fs: ProjectFS, p: string) =>
  (await fs.readText(p)).replace(/\r\n?/g, "\n");
export const normalizeChapter = (value: string | number) =>
  /^\d+$/.test(String(value)) ? String(value).padStart(3, "0") : String(value);
export function runPath(id: string): string {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    )
  )
    throw new Error("Invalid run ID");
  return `${DIRECTORY}/${id}/run.json`;
}
const runDirectory = (id: string) => runPath(id).slice(0, -"/run.json".length);
export function inputDigest(value: unknown): string {
  const ordered = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(ordered)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, item]) => [k, ordered(item)]),
          )
        : v;
  return createHash("sha256")
    .update(JSON.stringify(ordered(value)))
    .digest("hex");
}
export async function loadRun(fs: ProjectFS, id: string): Promise<ChapterRun> {
  return (await parse(fs, runPath(id))) as unknown as ChapterRun;
}
function move(run: ChapterRun, status: RunStatus): void {
  if (
    !["FAILED", "FAILED_PRECONDITION", "CANCELLED"].includes(status) &&
    !NORMAL[run.status]?.includes(status)
  )
    throw new Error(`Invalid pipeline transition: ${run.status} -> ${status}`);
  if (
    ["DONE", "CANCELLED", "FAILED", "FAILED_PRECONDITION", "RETURNED"].includes(
      run.status,
    )
  )
    throw new Error(`Run is already terminal: ${run.status}`);
  run.status = status;
  run.events.push({ status, time: new Date().toISOString() });
}
function ensureLive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new RoleAbortError("Chapter run cancelled");
}
async function checkpoint(
  fs: ProjectFS,
  run: ChapterRun,
  status: RunStatus,
  ctx: PipelineContext,
): Promise<void> {
  ensureLive(ctx.signal);
  if (run.status === status) return;
  const sequence: RunStatus[] = [
    "REQUESTED",
    "READINESS_OK",
    "PACKET_COMPILED",
    "AUTHOR_DONE",
    "READER_DONE",
    "EDITOR_DONE",
    "PLOT_CHECKED",
    "REALITY_CHECKED",
    "AWAITING_CANDIDATE_APPROVAL",
  ];
  if (
    sequence.includes(status) &&
    sequence.indexOf(run.status) >= sequence.indexOf(status)
  )
    return;
  move(run, status);
  if (ctx.onCheckpoint || run.literaryProblemsRecorded)
    await fs.transaction(async (tx) => {
      await syncProblemStatus(tx, run, ctx);
      await write(tx, runPath(run.id), run);
      await ctx.onCheckpoint?.(tx, run);
    });
  else await write(fs, runPath(run.id), run);
  ctx.onProgress?.(structuredClone(run));
}
async function call(
  fs: ProjectFS,
  run: ChapterRun,
  id: RoleId,
  input: Data,
  ctx: PipelineContext,
): Promise<RoleResult> {
  ensureLive(ctx.signal);
  let result: RoleResult;
  try {
    result = ctx.executeRole
      ? await ctx.executeRole(id, input, { ...ctx, fs }, run)
      : await runRole(id, input, { ...ctx, fs });
  } catch (error) {
    run.failedRole = id;
    if (error instanceof RoleExecutionError && error.partial)
      await storeResult(fs, run, id, error.partial, ctx);
    throw error;
  }
  await storeResult(fs, run, id, result, ctx);
  ensureLive(ctx.signal);
  return result;
}
async function storeResult(
  fs: ProjectFS,
  run: ChapterRun,
  id: RoleId,
  result: RoleResult,
  ctx: PipelineContext,
): Promise<void> {
  const p = `${runDirectory(run.id)}/${id}.json`;
  run.roles[id] = {
    path: p,
    cost: result.costTotal,
    promptSha256: result.promptSha256,
    model: result.model,
  };
  run.costTotal = Object.values(run.roles).reduce(
    (total, role) => total + (role?.cost ?? 0),
    0,
  );
  await fs.transaction(async (tx) => {
    if (
      id === CHAPTER_ROLES.editor &&
      object(result.output) &&
      Array.isArray(result.output.problems)
    ) {
      await candidateProblems.record(
        tx,
        {
          projectId: ctx.projectId ?? ctx.projectKey,
          chapter: run.chapter,
          runId: run.id,
          status: candidateProblems.statusFromRun(run as unknown as Data),
        },
        result.output.problems,
      );
      run.literaryProblemsRecorded = result.output.problems.length > 0;
    }
    await write(tx, p, publicRoleResult(result));
    await write(tx, runPath(run.id), run);
  });
}
async function syncProblemStatus(
  fs: ProjectFS,
  run: ChapterRun,
  ctx: PipelineContext,
) {
  await candidateProblems.setStatus(
    fs,
    run.id,
    candidateProblems.statusFromRun(run as unknown as Data),
    ctx.projectId ?? ctx.projectKey,
  );
}
async function stopOnError(
  fs: ProjectFS,
  run: ChapterRun,
  error: unknown,
  ctx: PipelineContext,
): Promise<ChapterRun> {
  run.error = (error as Error).message;
  const status: RunStatus =
    error instanceof RoleAbortError || ctx.signal?.aborted
      ? "CANCELLED"
      : ["REQUESTED", "READINESS_OK"].includes(run.status)
        ? "FAILED_PRECONDITION"
        : "FAILED";
  move(run, status);
  if (ctx.onCheckpoint || run.literaryProblemsRecorded)
    await fs.transaction(async (tx) => {
      await syncProblemStatus(tx, run, ctx);
      await write(tx, runPath(run.id), run);
      await ctx.onCheckpoint?.(tx, run);
    });
  else await write(fs, runPath(run.id), run);
  ctx.onProgress?.(structuredClone(run));
  return run;
}
async function returnRun(
  fs: ProjectFS,
  run: ChapterRun,
  to: string,
  reason: string,
  ctx: PipelineContext,
): Promise<ChapterRun> {
  run.returnedTo = to;
  run.returnReason = reason;
  await checkpoint(fs, run, "RETURNED", ctx);
  return run;
}
export async function startChapter(
  fs: ProjectFS,
  request: ChapterRequest,
  context: PipelineContext,
): Promise<ChapterRun> {
  const id = context.runId ?? randomUUID();
  const prior =
    context.runId && (await fs.exists(runPath(id)))
      ? await loadRun(fs, id)
      : undefined;
  if (
    prior &&
    (prior.projectKey !== context.projectKey ||
      prior.requestSha256 !== inputDigest(request))
  )
    throw new Error("Run identity or request changed");
  if (
    prior &&
    ![
      "REQUESTED",
      "READINESS_OK",
      "PACKET_COMPILED",
      "AUTHOR_DONE",
      "READER_DONE",
      "EDITOR_DONE",
      "PLOT_CHECKED",
      "REALITY_CHECKED",
    ].includes(prior.status)
  )
    return prior;
  const control = new AbortController();
  active.set(`${fs.root}:${id}`, { control, projectKey: context.projectKey });
  const signal = context.signal
    ? AbortSignal.any([control.signal, context.signal])
    : control.signal;
  const ctx = { ...context, signal };
  const run: ChapterRun = prior ?? {
    id,
    projectKey: ctx.projectKey,
    chapter: normalizeChapter(request.chapter),
    target: fs.path(
      request.target ??
        `chapters/chapter-${normalizeChapter(request.chapter)}.md`,
    ),
    status: "REQUESTED",
    paths: {},
    roles: {},
    costTotal: 0,
    events: [{ status: "REQUESTED", time: new Date().toISOString() }],
    requestSha256: inputDigest(request),
  };
  if (!prior) {
    if (ctx.onCheckpoint)
      await fs.transaction(async (tx) => {
        await write(tx, runPath(id), run);
        await ctx.onCheckpoint?.(tx, run);
      });
    else await write(fs, runPath(id), run);
  }
  ctx.onProgress?.(structuredClone(run));
  try {
    ensureLive(signal);
    const ready = await checks.projectReadiness(fs);
    if (!ready.ready) throw new Error(ready.errors.join("；"));
    const current = await state.loadState(fs);
    const status = await state.computeStatus(fs, current);
    if (!status.ready_to_compile)
      throw new Error(
        "Chapter sources are stale or previous approvals are pending",
      );
    const projection = current.active_projection;
    if (
      !object(projection) ||
      !object(projection.context_scope) ||
      projection.chapter !== run.chapter ||
      projection.context_scope.project !== ctx.projectKey
    )
      throw new Error(
        "Requested chapter/project does not match the approved situation",
      );
    const manifest =
      request.manifest ?? "authoring-ruwen-v5/manifests/author-manifest.json";
    run.paths.manifest = manifest;
    if (run.status === "REQUESTED" && (await fs.exists(run.target)))
      run.targetBeforeSha256 = await fs.sha256(run.target);
    await checkpoint(fs, run, "READINESS_OK", ctx);
    if (!run.packetSha256) {
      await ensureExactTextChapter(fs, manifest, run.chapter);
      const compiled = await packet.compilePacket(fs, manifest);
      run.paths.source_packet = compiled.output;
      run.paths.packet = `${runDirectory(id)}/packet.md`;
      await fs.write(run.paths.packet, await fs.read(compiled.output));
      run.packetSha256 = await fs.sha256(run.paths.packet);
    } else if (
      !run.paths.packet ||
      !run.paths.source_packet ||
      (await fs.sha256(run.paths.packet)) !== run.packetSha256 ||
      (await fs.sha256(run.paths.source_packet)) !== run.packetSha256
    )
      throw new Error("Author packet changed while run was interrupted");
    const promisesPath = `${runDirectory(id)}/promises.json`;
    let lockedEvents = request.lockedEvents ?? [];
    let lockedOrder = request.lockedOrder ?? [];
    if (
      request.lockedEvents === undefined &&
      typeof projection.path === "string" &&
      (await fs.exists(`${projection.path}.promises.json`))
    ) {
      const value = await parse(fs, `${projection.path}.promises.json`);
      if (
        value.projection_sha256 !== (await fs.sha256(projection.path)) ||
        !Array.isArray(value.locked_events) ||
        !value.locked_events.every((v) => typeof v === "string") ||
        !Array.isArray(value.locked_order) ||
        !value.locked_order.every((v) => typeof v === "string")
      )
        throw new Error("Locked commitments are stale or malformed");
      lockedEvents = value.locked_events as string[];
      lockedOrder = value.locked_order as string[];
    }
    await write(fs, promisesPath, {
      locked_events: lockedEvents,
      locked_order: lockedOrder,
    });
    run.paths.promises = promisesPath;
    await checkpoint(fs, run, "PACKET_COMPILED", ctx);
    const author = await call(
      fs,
      run,
      CHAPTER_ROLES.author,
      { packet: await text(fs, String(run.paths.packet)) },
      ctx,
    );
    if (typeof author.output !== "string")
      throw new Error("Author did not return prose");
    run.paths.author = `authoring-ruwen-v5/candidates/${id}-author.md`;
    await fs.write(run.paths.author, author.output);
    await checkpoint(fs, run, "AUTHOR_DONE", ctx);
    const previousTail =
      object(current.last_approved_prose) &&
      typeof current.last_approved_prose.path === "string"
        ? Array.from(await text(fs, current.last_approved_prose.path))
            .slice(-600)
            .join("")
        : "";
    const reading = await call(
      fs,
      run,
      CHAPTER_ROLES.reader,
      {
        prose: author.output,
        chapter: run.chapter,
        previous_tail: previousTail,
      },
      ctx,
    );
    await checkpoint(fs, run, "READER_DONE", ctx);
    run.paths.original = `authoring-ruwen-v5/candidates/${id}-original.md`;
    await fs.write(run.paths.original, await fs.read(run.paths.author));
    const edited = asData(
      (
        await call(
          fs,
          run,
          CHAPTER_ROLES.editor,
          {
            prose: author.output,
            reading: { reactions: asData(reading.output).reactions ?? [] },
          },
          ctx,
        )
      ).output,
    );
    await checkpoint(fs, run, "EDITOR_DONE", ctx);
    if (edited.decision === "RESTAGE")
      return await returnRun(
        fs,
        run,
        "author",
        String(edited.return_reason),
        ctx,
      );
    if (edited.decision === "RETURN_CONSTRUCTION")
      return await returnRun(
        fs,
        run,
        "ideation",
        String(edited.return_reason),
        ctx,
      );
    if (!Array.isArray(edited.edits) || Object.hasOwn(edited, "edited_text"))
      throw new Error("Editor output requires original → replacement edits");
    const applied = applyEditorialEdits(
      author.output,
      edited.edits as unknown as EditorialEdit[],
      editingPolicy(),
    );
    const prose = applied.text;
    if (checks.candidateProseErrors(prose).length)
      throw new Error(
        "Edited prose contains governance or compliance language",
      );
    run.paths.candidate = `authoring-ruwen-v5/candidates/${id}-candidate.md`;
    await fs.write(run.paths.candidate, prose);
    const changes = applied.changes;
    await write(
      fs,
      `${runDirectory(id)}/fact-changes.json`,
      changes.filter((c) => c.kind === "fact"),
    );
    await write(
      fs,
      `${runDirectory(id)}/literary-changes.json`,
      changes.filter((c) => c.kind === "literary"),
    );
    const plot = asData(
      (
        await call(
          fs,
          run,
          CHAPTER_ROLES.plot,
          { prose, locked_events: lockedEvents, locked_order: lockedOrder },
          ctx,
        )
      ).output,
    );
    await checkpoint(fs, run, "PLOT_CHECKED", ctx);
    if (!plot.pass)
      return await returnRun(
        fs,
        run,
        "zhangjie-qingjing-bianyiyuan",
        JSON.stringify(plot.issues),
        ctx,
      );
    const hardRules = await readAuthorizedResource(
      { ...ctx, fs },
      CHAPTER_ROLES.reality,
      "xiaoyan-yingsheding",
    );
    const reality = asData(
      (
        await call(
          fs,
          run,
          CHAPTER_ROLES.reality,
          { prose, hard_rules: [hardRules] },
          ctx,
        )
      ).output,
    );
    await checkpoint(fs, run, "REALITY_CHECKED", ctx);
    if (!reality.pass)
      return await returnRun(
        fs,
        run,
        "zhangjie-qingjing-bianyiyuan",
        JSON.stringify(reality.issues),
        ctx,
      );
    run.candidateSha256 = await fs.sha256(run.paths.candidate);
    await checkpoint(fs, run, "AWAITING_CANDIDATE_APPROVAL", ctx);
    return run;
  } catch (error) {
    return await stopOnError(fs, run, error, ctx);
  } finally {
    active.delete(`${fs.root}:${id}`);
  }
}
async function ownedRun(
  fs: ProjectFS,
  id: string,
  ctx: PipelineContext,
): Promise<ChapterRun> {
  const run = await loadRun(fs, id);
  if (run.projectKey !== ctx.projectKey)
    throw new Error("Project context mismatch");
  return run;
}
export async function approveCandidate(
  fs: ProjectFS,
  id: string,
  decision: UserApproval,
  context: PipelineContext,
): Promise<ChapterRun> {
  if (decision.confirmed !== true)
    throw new Error("Explicit user approval required");
  const control = new AbortController();
  const key = `${fs.root}:${id}`;
  const signal = context.signal
    ? AbortSignal.any([control.signal, context.signal])
    : control.signal;
  const ctx = { ...context, signal };
  let run = await ownedRun(fs, id, ctx);
  if (run.status !== "AWAITING_CANDIDATE_APPROVAL")
    throw new Error("Candidate is not awaiting approval");
  ensureLive(ctx.signal);
  try {
    await fs.transaction(async (tx) => {
      run = await ownedRun(tx, id, ctx);
      if (run.status !== "AWAITING_CANDIDATE_APPROVAL")
        throw new Error("Candidate was already processed");
      ensureLive(signal);
      const current = await state.loadState(tx);
      const currentPacket = current.active_packet;
      if (
        !object(currentPacket) ||
        currentPacket.path !== run.paths.source_packet ||
        currentPacket.sha256 !== run.packetSha256 ||
        !run.paths.packet ||
        (await tx.sha256(run.paths.packet)) !== run.packetSha256 ||
        !run.paths.source_packet ||
        (await tx.sha256(run.paths.source_packet)) !== run.packetSha256
      )
        throw new Error("Author packet changed since this run");
      const candidate = run.paths.candidate;
      if (
        !candidate ||
        (await tx.sha256(candidate)) !== decision.expectedSha256 ||
        run.candidateSha256 !== decision.expectedSha256
      )
        throw new Error("Candidate changed since review");
      if (await tx.exists(run.target)) {
        if (
          !run.targetBeforeSha256 ||
          decision.expectedTargetSha256 !== run.targetBeforeSha256 ||
          (await tx.sha256(run.target)) !== run.targetBeforeSha256
        )
          throw new Error(
            "Existing target requires its reviewed original hash",
          );
      } else if (run.targetBeforeSha256 || decision.expectedTargetSha256)
        throw new Error("Formal target changed since run start");
      active.set(key, { control, projectKey: ctx.projectKey });
      const event = await approval.createEvent(
        tx,
        `candidate-${id}`,
        "candidate_approve",
        candidate,
        true,
      );
      await state.recordApproved(
        tx,
        candidate,
        `run-${id}`,
        String(event.event),
      );
      await state.promoteApproved(
        tx,
        run.target,
        Boolean(run.targetBeforeSha256),
        decision.expectedTargetSha256,
      );
      await clearChapterExactText(tx, run.paths.manifest, run.chapter);
      move(run, "CANDIDATE_APPROVED");
      await syncProblemStatus(tx, run, ctx);
      await write(tx, runPath(id), run);
      await ctx.onCheckpoint?.(tx, run);
    });
    ctx.onProgress?.(structuredClone(run));
    if (ctx.deferMemory) return run;
    return await generateMemoryPreview(fs, id, ctx);
  } finally {
    if (active.get(key)?.control === control) active.delete(key);
  }
}
export async function generateMemoryPreview(
  fs: ProjectFS,
  id: string,
  context: PipelineContext,
): Promise<ChapterRun> {
  const run = await ownedRun(fs, id, context);
  if (run.status === "AWAITING_MEMORY_APPROVAL") return run;
  if (!["CANDIDATE_APPROVED", "MEMORY_PREVIEW_READY"].includes(run.status))
    throw new Error("Approved chapter is not awaiting memory generation");
  const control = new AbortController();
  const key = `${fs.root}:${id}`;
  active.set(key, { control, projectKey: context.projectKey });
  const ctx = {
    ...context,
    signal: context.signal
      ? AbortSignal.any([context.signal, control.signal])
      : control.signal,
  };
  try {
    const prose = await text(fs, run.target);
    const resources = await listAuthorizedResources(
      { ...ctx, fs },
      CHAPTER_ROLES.memory,
    );
    const memoryResult = await call(
      fs,
      run,
      CHAPTER_ROLES.memory,
      {
        approved_prose: prose,
        resources: resources.map((resource) => ({
          id: resource.id,
          path: resource.path,
          type: resource.type,
          scope: resource.scope,
          sha256: resource.source_sha256,
        })),
      },
      ctx,
    );
    const memory = asData(memoryResult.output);
    const requestedPatches = Array.isArray(memory.patches)
      ? memory.patches.filter(object)
      : [];
    const allowed = new Map(
      (memoryResult.readResources ?? []).map((resource) => [
        String(resource.path),
        resource.sha256,
      ]),
    );
    run.paths.memory_preview = await fs.transaction(async (tx) => {
      const patches: Data[] = [];
      for (const patch of requestedPatches) {
        if (
          typeof patch.path !== "string" ||
          !Array.isArray(patch.sections) ||
          Object.hasOwn(patch, "new_content") ||
          !allowed.has(tx.path(patch.path)) ||
          patch.base_sha256 !== allowed.get(tx.path(patch.path)) ||
          patch.base_sha256 !== (await tx.sha256(patch.path))
        )
          throw new Error(
            "Memory patch resource was not read in this role run or became stale",
          );
        const original = await tx.readText(patch.path);
        patches.push({
          path: patch.path,
          base_sha256: patch.base_sha256 ?? null,
          new_content: applySectionEdits(
            original,
            patch.sections as unknown as SectionEdit[],
            editingPolicy(),
          ),
        });
      }
      const expected = `authoring-ruwen-v5/reports/memory-${id}.json`;
      if (await tx.exists(expected)) {
        const existing = await parse(tx, expected);
        const canonical = patches.map((p) => ({
          path: tx.path(String(p.path)),
          base_sha256: p.base_sha256,
          new_content: p.new_content,
        }));
        if (
          existing.kind !== "memory_change_preview" ||
          inputDigest(existing.patches) !== inputDigest(canonical) ||
          existing.registry_sha256 !== (await tx.sha256("治理/资源注册表.json"))
        )
          throw new Error("Existing memory preview changed or became stale");
        return expected;
      }
      return createMemoryPreview(
        tx,
        `memory-${id}`,
        patches.map((p) => ({
          path: String(p.path),
          new_content: String(p.new_content),
        })),
      );
    });
    run.memoryPreviewSha256 = await fs.sha256(run.paths.memory_preview);
    await checkpoint(fs, run, "MEMORY_PREVIEW_READY", ctx);
    await checkpoint(fs, run, "AWAITING_MEMORY_APPROVAL", ctx);
    return run;
  } catch (error) {
    return stopOnError(fs, run, error, ctx);
  } finally {
    if (active.get(key)?.control === control) active.delete(key);
  }
}
export async function approveMemory(
  fs: ProjectFS,
  id: string,
  decision: UserApproval,
  ctx: PipelineContext,
): Promise<ChapterRun> {
  if (decision.confirmed !== true)
    throw new Error("Explicit user approval required");
  ensureLive(ctx.signal);
  const committed = await fs.transaction(async (tx) => {
    const run = await ownedRun(tx, id, ctx);
    if (run.status !== "AWAITING_MEMORY_APPROVAL")
      throw new Error("Memory is not awaiting approval");
    const preview = run.paths.memory_preview;
    if (
      !preview ||
      (await tx.sha256(preview)) !== decision.expectedSha256 ||
      run.memoryPreviewSha256 !== decision.expectedSha256
    )
      throw new Error("Memory preview changed since review");
    const event = await approval.createEvent(
      tx,
      `memory-${id}`,
      "memory_commit",
      preview,
      true,
    );
    await commitMemoryPreview(tx, preview, String(event.event));
    move(run, "MEMORY_COMMITTED");
    await ctx.onCheckpoint?.(tx, run);
    move(run, "DONE");
    await write(tx, runPath(id), run);
    await ctx.onCheckpoint?.(tx, run);
    return run;
  });
  ctx.onProgress?.(structuredClone(committed));
  return committed;
}
export async function cancelRun(
  fs: ProjectFS,
  id: string,
  ctx: PipelineContext,
): Promise<ChapterRun> {
  const inFlight = active.get(`${fs.root}:${id}`);
  if (inFlight) {
    if (inFlight.projectKey !== ctx.projectKey)
      throw new Error("Project context mismatch");
    inFlight.control.abort();
    return ownedRun(fs, id, ctx);
  }
  const run = await fs.transaction(async (tx) => {
    const current = await ownedRun(tx, id, ctx);
    const running = active.get(`${fs.root}:${id}`);
    if (running) {
      running.control.abort();
      return current;
    }
    if (current.status !== "CANCELLED") {
      move(current, "CANCELLED");
      await syncProblemStatus(tx, current, ctx);
      await write(tx, runPath(id), current);
      await ctx.onCheckpoint?.(tx, current);
    }
    return current;
  });
  ctx.onProgress?.(structuredClone(run));
  return run;
}
export async function returnCandidate(
  fs: ProjectFS,
  id: string,
  reason: string,
  ctx: PipelineContext,
): Promise<ChapterRun> {
  const returned = await fs.transaction(async (tx) => {
    const run = await ownedRun(tx, id, ctx);
    if (run.status !== "AWAITING_CANDIDATE_APPROVAL")
      throw new Error("Candidate is not awaiting approval");
    run.returnedTo = "ideation";
    run.returnReason = reason;
    ensureLive(ctx.signal);
    move(run, "RETURNED");
    await syncProblemStatus(tx, run, ctx);
    await write(tx, runPath(id), run);
    await ctx.onCheckpoint?.(tx, run);
    return run;
  });
  ctx.onProgress?.(structuredClone(returned));
  return returned;
}

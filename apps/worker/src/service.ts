import { randomUUID } from "node:crypto";
import {
  assemblePrompt,
  authorizedResourceInputs,
  createFauxRuntime,
  type Data,
  DEFAULT_ROLE_TIMEOUT_MS,
  deploymentCanary,
  type ModelRuntime,
  ROLE_OUTPUT_ATTEMPTS,
  ROLES,
  RoleAbortError,
  RoleExecutionError,
  type RoleId,
  type RoleResult,
  runRole,
} from "@ruwen/agents";
import {
  assertRunEnabled,
  currentBank,
  finishReservation,
  initializeBilling,
  projectSql,
  quoteRun,
  reserveRun,
  settleRole,
} from "@ruwen/billing";
import {
  assertInputLimits,
  candidateProblems,
  checks,
  handoff,
  type ProjectFS,
  publicRoleResult,
  publicTranscript,
  state,
} from "@ruwen/core";
import { Database, PostgresFS } from "@ruwen/db";
import {
  approveCandidate,
  approveMemory,
  CHAPTER_ROLES,
  type ChapterRequest,
  type ChapterRun,
  cancelRun,
  generateMemoryPreview,
  InterruptedRoleError,
  inputDigest,
  loadRun,
  normalizeChapter,
  type PipelineContext,
  returnCandidate as returnChapterCandidate,
  runPath,
  startChapter,
  type UserApproval,
} from "@ruwen/pipeline";
import { PgBoss } from "pg-boss";
import { runtimeSettings } from "../../../config/settings.ts";
import type { IdeationSessionOptions } from "../../../packages/pipeline/src/ideation/sessions.ts";
import { IdeationRunner } from "./ideation-runner.ts";
import { persistPrivatePrompt } from "./private-prompts.ts";
import { recordRoleSecurityEvents } from "./security-events.ts";
import { streamSink } from "./stream-events.ts";

export { createIdeationService } from "./ideation-service.ts";

type Kind =
  | "chapter"
  | "candidate"
  | "memory_preview"
  | "memory"
  | "cancel"
  | "ideation"
  | "dispatch";
export interface Task {
  kind: Kind;
  projectId: string;
  ownerId: string;
  runId: string;
  decision?: UserApproval;
  lockDeferrals?: number;
}
export interface WorkerOptions {
  ideation?: Omit<IdeationSessionOptions, "modelMode" | "queue">;
  runtime: () => ModelRuntime;
  runtimeForRequest?: (request: Data) => ModelRuntime;
  queue?: string;
  heartbeatSeconds?: number;
  concurrency?: number;
  roleTimeoutMs?: number;
  queueMarginSeconds?: number;
  onBoundary?: (
    kind: "checkpoint" | "role_intent" | "role_response" | "role_completed",
    name: string,
    runId: string,
  ) => Promise<void>;
  onError?: (error: Error) => void;
}
const DISPATCH_ROLES: RoleId[] = [
  "xiangmu-zhiliyuan",
  "waibu-zhishi-guwen",
  "biaoxian-shejishi",
  "gushi-gousishi",
];
const terminal = [
  "DONE",
  "RETURNED",
  "FAILED",
  "FAILED_PRECONDITION",
  "CANCELLED",
];
export function queueExpirySeconds(
  roleTimeoutMs: number,
  roleCount: number,
  attempts: number,
  marginSeconds: number,
) {
  if (
    !Number.isFinite(roleTimeoutMs) ||
    roleTimeoutMs <= 0 ||
    !Number.isInteger(roleCount) ||
    roleCount < 1 ||
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    !Number.isInteger(marginSeconds) ||
    marginSeconds < 0
  )
    throw new Error("Invalid queue time budget");
  const seconds =
    Math.ceil((roleTimeoutMs * roleCount * attempts) / 1000) + marginSeconds;
  if (!Number.isSafeInteger(seconds))
    throw new Error("Queue time budget is too large");
  return seconds;
}
export class WorkerService {
  readonly ideationRunner: IdeationRunner;
  readonly db: Database;
  readonly boss: PgBoss;
  readonly queue: string;
  readonly scheduling: {
    concurrency: number;
    roleTimeoutMs: number;
    expireInSeconds: number;
  };
  private options: WorkerOptions;
  private active = new Map<string, AbortController>();
  constructor(connectionString: string, options: WorkerOptions) {
    const concurrency =
      options.concurrency ?? runtimeSettings().execution.concurrency;
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
      throw new Error(
        "Worker concurrency must be between 1 and 4 for the 12-connection project pool",
      );
    const roleTimeoutMs = options.roleTimeoutMs ?? DEFAULT_ROLE_TIMEOUT_MS;
    this.scheduling = {
      concurrency,
      roleTimeoutMs,
      expireInSeconds: queueExpirySeconds(
        roleTimeoutMs,
        Object.keys(CHAPTER_ROLES).length,
        ROLE_OUTPUT_ATTEMPTS,
        options.queueMarginSeconds ??
          runtimeSettings().execution.queueMarginSeconds,
      ),
    };
    this.db = new Database(connectionString);
    this.boss = new PgBoss({
      connectionString,
      superviseIntervalSeconds: 1,
      monitorIntervalSeconds: 5,
      maintenanceIntervalSeconds: 60,
    });
    this.options = options;
    this.queue = options.queue ?? "ruwen-work";
    this.ideationRunner = new IdeationRunner(
      this.db,
      this.boss,
      this.queue,
      options,
    );
    this.boss.on("error", (error) => options.onError?.(error));
  }
  async start(consume = true) {
    deploymentCanary();
    try {
      await this.db.migrate();
      await initializeBilling(this.db);
      await this.boss.start();
      await this.boss.createQueue(this.queue, {
        retryLimit: 5,
        retryDelay: 1,
        expireInSeconds: this.scheduling.expireInSeconds,
        heartbeatSeconds: this.options.heartbeatSeconds ?? 20,
      });
      await this.boss.updateQueue(this.queue, {
        expireInSeconds: this.scheduling.expireInSeconds,
      });
      if (consume) {
        this.ideationRunner.start();
        await this.boss.work<Task>(
          this.queue,
          {
            pollingIntervalSeconds: 0.5,
            localConcurrency: this.scheduling.concurrency,
          },
          async (jobs) => {
            for (const job of jobs) await this.handle(job.data, job.signal);
          },
        );
      }
    } catch (error) {
      await this.ideationRunner.stop();
      await this.boss.stop({ graceful: false }).catch(() => {});
      await this.db.close().catch(() => {});
      throw error;
    }
  }
  async stop() {
    for (const control of this.active.values()) control.abort();
    await this.ideationRunner.stop();
    await this.boss.stop({ graceful: true, timeout: 10000 });
    await this.db.close();
  }
  private adapter(fs: PostgresFS) {
    return {
      executeSql: (query: string, values?: unknown[]) =>
        fs.sql(query, values ?? []),
    };
  }
  private async send(fs: PostgresFS, task: Task) {
    return this.boss.send(this.queue, task, {
      singletonKey: `${task.runId}:${task.kind}`,
      db: this.adapter(fs),
    });
  }
  async enqueueChapter(fs: PostgresFS, request: ChapterRequest) {
    assertInputLimits(request);
    const id = randomUUID();
    await fs.transaction(async (tx) => {
      const quote = await quoteRun(
        projectSql(tx),
        fs.ownerId,
        currentBank(),
        "chapter",
      );
      await tx.sql(
        "INSERT INTO pipeline_runs(id,project_id,kind,chapter,status,request) VALUES($1,$2,'chapter_run',$3,'REQUESTED',$4)",
        [id, fs.projectId, String(request.chapter), JSON.stringify(request)],
      );
      await reserveRun(projectSql(tx), id, quote);
      const queued = await this.send(tx, {
        kind: "chapter",
        projectId: fs.projectId,
        ownerId: fs.ownerId,
        runId: id,
      });
      if (!queued) throw new Error("Chapter queue did not accept task");
    });
    return id;
  }
  async enqueueApproval(
    fs: PostgresFS,
    id: string,
    kind: "candidate" | "memory",
    decision: UserApproval,
  ) {
    if (decision.confirmed !== true)
      throw new Error("Explicit user approval required");
    return fs.transaction(async (tx) => {
      const run = await loadRun(tx, id);
      const expected =
        kind === "candidate" ? run.candidateSha256 : run.memoryPreviewSha256;
      const target =
        kind === "candidate" ? run.paths.candidate : run.paths.memory_preview;
      if (
        run.status !==
          (kind === "candidate"
            ? "AWAITING_CANDIDATE_APPROVAL"
            : "AWAITING_MEMORY_APPROVAL") ||
        !target ||
        expected !== decision.expectedSha256 ||
        (await tx.sha256(target)) !== expected
      )
        throw new Error("Approval is stale or run is not awaiting approval");
      return this.send(tx, {
        kind,
        projectId: fs.projectId,
        ownerId: fs.ownerId,
        runId: id,
        decision,
      });
    });
  }
  async enqueueDispatch(fs: PostgresFS, value: Data) {
    assertInputLimits(value);
    const id = randomUUID();
    await fs.transaction(async (tx) => {
      const project = await tx.sql<{ project_key: string }>(
        "SELECT project_key FROM projects WHERE id=$1",
        [fs.projectId],
      );
      const scope = value.scope;
      if (
        !scope ||
        typeof scope !== "object" ||
        Array.isArray(scope) ||
        scope.project !== project.rows[0]?.project_key ||
        !DISPATCH_ROLES.includes(value.recipient as RoleId)
      )
        throw new Error("Handoff project or recipient mismatch");
      const errors = await handoff.executeHandoff(tx, value);
      if (errors.length) throw new Error(errors.join("；"));
      await tx.sql(
        "INSERT INTO pipeline_runs(id,project_id,kind,status,request) VALUES($1,$2,'ideation_dispatch','REQUESTED',$3)",
        [id, fs.projectId, JSON.stringify(value)],
      );
      await this.send(tx, {
        kind: "dispatch",
        projectId: fs.projectId,
        ownerId: fs.ownerId,
        runId: id,
      });
    });
    return id;
  }
  async cancel(fs: PostgresFS, id: string) {
    await fs.transaction(async (tx) => {
      const result = await tx.sql(
        "UPDATE pipeline_runs SET cancel_requested=true WHERE id=$1 AND project_id=$2 RETURNING id",
        [id, fs.projectId],
      );
      if (!result.rowCount) throw new Error("Run does not belong to project");
      await this.send(tx, {
        kind: "cancel",
        projectId: fs.projectId,
        ownerId: fs.ownerId,
        runId: id,
      });
    });
    this.active.get(id)?.abort();
  }
  async enqueueCompile(
    fs: PostgresFS,
    chapter: string,
    scope: Data,
    lockedEvents: string[] = [],
    lockedOrder: string[] = [],
  ) {
    assertInputLimits({ chapter, scope, lockedEvents, lockedOrder });
    const id = randomUUID();
    const normalized = normalizeChapter(chapter);
    await fs.transaction(async (tx) => {
      const project = await tx.sql<{ project_key: string }>(
        "SELECT project_key FROM projects WHERE id=$1",
        [fs.projectId],
      );
      if (
        scope.project !== project.rows[0]?.project_key ||
        (scope.chapter != null &&
          normalizeChapter(String(scope.chapter)) !== normalized) ||
        Object.keys(scope).some(
          (key) =>
            ![
              "project",
              "volume",
              "arc",
              "chapter",
              "scene_type",
              "pov",
            ].includes(key),
        ) ||
        Object.values(scope).some(
          (value) => value !== null && typeof value !== "string",
        ) ||
        ![...lockedEvents, ...lockedOrder].every(
          (value) => typeof value === "string",
        )
      )
        throw new Error("Invalid compilation scope or locked commitments");
      const request = {
        kind: "compile_request",
        chapter: normalized,
        scope,
        locked_events: lockedEvents,
        locked_order: lockedOrder,
      };
      await tx.sql(
        "INSERT INTO pipeline_runs(id,project_id,kind,chapter,status,request) VALUES($1,$2,'ideation_dispatch',$3,'REQUESTED',$4)",
        [id, fs.projectId, normalized, JSON.stringify(request)],
      );
      await this.send(tx, {
        kind: "dispatch",
        projectId: fs.projectId,
        ownerId: fs.ownerId,
        runId: id,
      });
    });
    return id;
  }
  async returnCandidate(fs: PostgresFS, id: string, reason: string) {
    const run = await loadRun(fs, id);
    return returnChapterCandidate(fs, id, reason, {
      projectKey: run.projectKey,
      projectId: fs.projectId,
      runtime: createFauxRuntime(),
      onCheckpoint: (tx, next) => this.checkpoint(tx, next),
    });
  }
  private async checkpoint(fs: ProjectFS, run: ChapterRun) {
    if (!(fs instanceof PostgresFS))
      throw new Error("Durable checkpoint requires PostgresFS");
    const row = await fs.sql<{ cancel_requested: boolean }>(
      "SELECT cancel_requested FROM pipeline_runs WHERE id=$1 AND project_id=$2",
      [run.id, fs.projectId],
    );
    if (!row.rows[0]) throw new Error("Unknown project run");
    if (
      row.rows[0].cancel_requested &&
      !["CANCELLED", "REQUESTED"].includes(run.status)
    )
      throw new RoleAbortError("Cancellation requested");
    await fs.sql(
      "UPDATE pipeline_runs SET status=$3,finished_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE id=$1 AND project_id=$2",
      [run.id, fs.projectId, run.status, terminal.includes(run.status)],
    );
    if (terminal.includes(run.status))
      await finishReservation(projectSql(fs), fs.ownerId, run.id);
    for (const event of run.events)
      await fs.sql(
        "INSERT INTO pipeline_steps(run_id,step,status,output_ref,started_at,finished_at) VALUES($1,$2,'completed',$3,$4,$4) ON CONFLICT(run_id,step) DO NOTHING",
        [
          run.id,
          event.status,
          JSON.stringify({ path: runPath(run.id), roles: run.roles }),
          event.time,
        ],
      );
    await fs.sql("SELECT pg_notify('ruwen_runs',$1)", [
      JSON.stringify({
        projectId: fs.projectId,
        runId: run.id,
        status: run.status,
      }),
    ]);
    await this.options.onBoundary?.("checkpoint", run.status, run.id);
  }
  private async cachedRole(
    fs: PostgresFS,
    run: ChapterRun,
    id: RoleId,
    input: Data,
    ctx: Parameters<typeof runRole>[2],
  ): Promise<RoleResult> {
    assertInputLimits(input);
    const hash = inputDigest(input);
    const cached = await fs.transaction(async (tx) => {
      const row = await tx.sql<{
        status: string;
        input_sha256: string;
        result: RoleResult | null;
      }>(
        "SELECT status,input_sha256,result FROM role_runs WHERE run_id=$1 AND role_id=$2",
        [run.id, id],
      );
      const existing = row.rows[0];
      if (existing) {
        if (existing.input_sha256 !== hash)
          throw new InterruptedRoleError(
            "Role inputs changed during recovery; automatic rerun blocked",
          );
        if (existing.status === "completed" && existing.result)
          return publicRoleResult(existing.result) as unknown as RoleResult;
        if (existing.status === "failed" && existing.result) {
          const error = new RoleExecutionError(
            "Previous role failed; automatic rerun blocked",
          );
          error.partial = publicRoleResult(
            existing.result,
          ) as unknown as RoleResult;
          throw error;
        }
        throw new InterruptedRoleError(
          "Role was interrupted with an unknown provider outcome; automatic rerun blocked, manual review required",
        );
      }
      await assertRunEnabled(projectSql(tx), fs.ownerId, run.id);
      const prompt = await assemblePrompt(ROLES[id], ctx.upstreamRoot);
      await tx.sql(
        "INSERT INTO prompts(sha256,content) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [prompt.sha256, prompt.content],
      );
      const route = ctx.runtime.resolve(ROLES[id]);
      await tx.sql(
        "INSERT INTO role_runs(run_id,role_id,status,input_sha256,model,prompt_sha256) VALUES($1,$2,'running',$3,$4,$5)",
        [
          run.id,
          id,
          hash,
          `${route.model.provider}/${route.model.id}`,
          prompt.sha256,
        ],
      );
      return undefined;
    });
    if (cached) return cached;
    await this.options.onBoundary?.("role_intent", id, run.id);
    let result: RoleResult;
    let requested = false;
    try {
      result = await runRole(id, input, {
        ...ctx,
        onRequest: (request, role) => {
          requested = true;
          ctx.onRequest?.(request, role);
        },
        onPrompt: (prompt) => persistPrivatePrompt(fs, prompt),
      });
    } catch (error) {
      const partial =
        error instanceof RoleExecutionError ? error.partial : undefined;
      if (partial)
        await this.saveRole(
          fs,
          run.id,
          id,
          partial,
          "failed",
          partial.usageUnknown ?? false,
        );
      else if (!requested) {
        const intent = (
          await fs.transaction((tx) =>
            tx.sql<{ model: string; prompt_sha256: string }>(
              "SELECT model,prompt_sha256 FROM role_runs WHERE run_id=$1 AND role_id=$2",
              [run.id, id],
            ),
          )
        ).rows[0];
        if (intent)
          await this.saveRole(
            fs,
            run.id,
            id,
            {
              output: "",
              usage: [],
              costTotal: 0,
              usageUnknown: false,
              model: intent.model,
              promptSha256: intent.prompt_sha256,
              transcript: [],
              readResources: [],
              durationMs: 0,
            },
            "failed",
          );
      }
      throw error;
    }
    await this.options.onBoundary?.("role_response", id, run.id);
    await this.saveRole(fs, run.id, id, result, "completed");
    await this.options.onBoundary?.("role_completed", id, run.id);
    return result;
  }
  private async saveRole(
    fs: PostgresFS,
    runId: string,
    id: RoleId,
    result: RoleResult,
    status: string,
    usageUnknown = false,
  ) {
    if (!Number.isFinite(result.costTotal) || result.costTotal < 0)
      throw new Error("Invalid reported role cost");
    await fs.transaction(async (tx) => {
      if (
        id === CHAPTER_ROLES.editor &&
        typeof result.output === "object" &&
        Array.isArray(result.output.problems)
      ) {
        const run = await tx.sql<{ chapter: string; status: string }>(
          "SELECT chapter,status FROM pipeline_runs WHERE id=$1 AND project_id=$2",
          [runId, fs.projectId],
        );
        if (!run.rows[0]) throw new Error("Unknown editor run");
        await candidateProblems.record(
          tx,
          {
            projectId: fs.projectId,
            chapter: run.rows[0].chapter,
            runId,
            status: "pending",
          },
          result.output.problems,
        );
      }
      await recordRoleSecurityEvents(tx, runId, id, result);
      const changed = await tx.sql<{ id: string }>(
        "UPDATE role_runs SET status=$3,model=$4,prompt_sha256=$5,result=$6,transcript=$7,usage=$8,cost_usd=$9,cache_read_tokens=$10,cache_write_tokens=$11,usage_unknown=$12,finished_at=now() WHERE run_id=$1 AND role_id=$2 AND status='running' RETURNING id",
        [
          runId,
          id,
          status,
          result.model,
          result.promptSha256,
          JSON.stringify(publicRoleResult(result)),
          JSON.stringify(publicTranscript(result.transcript)),
          JSON.stringify(result.usage),
          !usageUnknown ? result.costTotal : null,
          result.usage.reduce((sum, usage) => sum + usage.cacheRead, 0),
          result.usage.reduce((sum, usage) => sum + usage.cacheWrite, 0),
          usageUnknown,
        ],
      );
      if (changed.rows[0] && result.usage.length) {
        await tx.sql(
          "INSERT INTO role_cost_events(role_run_id,cost_usd) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [changed.rows[0].id, result.costTotal],
        );
        await settleRole(projectSql(tx), fs.ownerId, runId, changed.rows[0].id);
      }
    });
  }
  async handle(task: Task, jobSignal?: AbortSignal) {
    if (task.kind === "ideation")
      return this.ideationRunner.handle(task, jobSignal);
    const fs = new PostgresFS(this.db, task.projectId, task.ownerId);
    const connection = await this.db.pool.connect();
    const control = new AbortController();
    const signal = jobSignal
      ? AbortSignal.any([jobSignal, control.signal])
      : control.signal;
    let timer: ReturnType<typeof setInterval> | undefined;
    let polling: Promise<void> | undefined;
    let locked = false;
    let released = false;
    let stream: ReturnType<typeof streamSink> | undefined;
    try {
      // Session lock serializes a project's jobs without holding an SQL transaction over model I/O.
      const lock = await connection.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
        [`ruwen:project:${task.projectId}`],
      );
      locked = lock.rows[0]?.locked === true;
      if (!locked) {
        connection.release();
        released = true;
        const deferrals = (task.lockDeferrals ?? 0) + 1;
        const delayMs = Math.min(30_000, 250 * 2 ** Math.min(deferrals - 1, 7));
        const queued = await this.boss.sendAfter(
          this.queue,
          { ...task, lockDeferrals: deferrals },
          { singletonKey: `${task.runId}:${task.kind}` },
          new Date(Date.now() + delayMs),
        );
        if (!queued) throw new Error("Could not defer busy project job");
        return;
      }
      const row = await fs.transaction((tx) =>
        tx.sql<{
          project_key: string;
          request: Data;
          status: string;
          cancel_requested: boolean;
          kind: string;
        }>(
          "SELECT p.project_key,r.request,r.status,r.cancel_requested,r.kind FROM pipeline_runs r JOIN projects p ON p.id=r.project_id WHERE r.id=$1 AND r.project_id=$2",
          [task.runId, task.projectId],
        ),
      );
      const stored = row.rows[0];
      if (!stored) throw new Error("Run does not belong to this project");
      if (
        (task.kind === "dispatch" && stored.kind !== "ideation_dispatch") ||
        (task.kind !== "dispatch" &&
          task.kind !== "cancel" &&
          stored.kind !== "chapter_run")
      )
        throw new Error("Queue task kind mismatch");
      this.active.set(task.runId, control);
      stream = streamSink(
        this.db,
        fs.projectId,
        task.runId,
        this.options.onError,
      );
      if (stored.cancel_requested) control.abort();
      const poll = () => {
        if (polling) return;
        polling = this.db.pool
          .query<{ cancel_requested: boolean }>(
            "SELECT cancel_requested FROM pipeline_runs WHERE id=$1 AND project_id=$2",
            [task.runId, task.projectId],
          )
          .then((row) => {
            if (row.rows[0]?.cancel_requested) control.abort();
          })
          .catch(() => control.abort())
          .finally(() => {
            polling = undefined;
          });
      };
      timer = setInterval(poll, 200);
      const ctx: PipelineContext = {
        projectId: fs.projectId,
        projectKey: stored.project_key,
        runtime:
          this.options.runtimeForRequest?.(stored.request) ??
          this.options.runtime(),
        runId: task.runId,
        signal,
        // runRole invokes this only after its output security layer releases text.
        // Never feed provider events, thinking or raw transcripts into the sink.
        onDelta: (delta, role) => stream?.push(delta, role),
        onAttemptReset: (role, reason) => stream?.reset(role, reason),
        ...(this.options.roleTimeoutMs === undefined
          ? {}
          : { timeoutMs: this.scheduling.roleTimeoutMs }),
        executeRole: (id, input, ctx, run) =>
          this.cachedRole(fs, run, id, input, ctx),
        onCheckpoint: (tx, run) => this.checkpoint(tx, run),
      };
      if (task.kind === "dispatch") {
        await this.dispatch(fs, task.runId, stored.request, ctx, stored.status);
        return;
      }
      if (task.kind === "cancel" && stored.kind === "ideation_dispatch") {
        await fs.transaction(async (tx) => {
          await tx.sql(
            "UPDATE pipeline_runs SET status='CANCELLED',finished_at=now() WHERE id=$1 AND status NOT IN ('FAILED','CANCELLED')",
            [task.runId],
          );
          await tx.sql(
            "UPDATE previews SET status='rejected' WHERE id=$1 AND status='pending'",
            [task.runId],
          );
          await tx.sql("SELECT pg_notify('ruwen_runs',$1)", [
            JSON.stringify({
              projectId: fs.projectId,
              runId: task.runId,
              status: "CANCELLED",
            }),
          ]);
        });
        return;
      }
      if (task.kind === "chapter") {
        return await startChapter(
          fs,
          stored.request as unknown as ChapterRequest,
          ctx,
        );
      }
      const run = await loadRun(fs, task.runId);
      if (task.kind === "cancel")
        return terminal.includes(run.status)
          ? run
          : await cancelRun(fs, run.id, ctx);
      if (task.kind === "candidate") {
        if (!task.decision || task.decision.confirmed !== true)
          throw new Error("Missing user approval");
        if (run.candidateSha256 !== task.decision.expectedSha256)
          throw new Error("Approval hash does not match run");
        if (run.status === "AWAITING_CANDIDATE_APPROVAL")
          await approveCandidate(fs, run.id, task.decision, {
            ...ctx,
            deferMemory: true,
          });
        else if (
          ![
            "CANDIDATE_APPROVED",
            "MEMORY_PREVIEW_READY",
            "AWAITING_MEMORY_APPROVAL",
            "DONE",
          ].includes(run.status)
        )
          throw new Error("Candidate cannot be approved at this state");
        const latest = await loadRun(fs, run.id);
        if (
          ["CANDIDATE_APPROVED", "MEMORY_PREVIEW_READY"].includes(latest.status)
        )
          await fs.transaction((tx) =>
            this.send(tx, {
              kind: "memory_preview",
              projectId: task.projectId,
              ownerId: task.ownerId,
              runId: task.runId,
            }),
          );
        return latest;
      }
      if (task.kind === "memory_preview")
        return await generateMemoryPreview(fs, run.id, ctx);
      if (task.kind === "memory") {
        if (
          !task.decision ||
          task.decision.confirmed !== true ||
          task.decision.expectedSha256 !== run.memoryPreviewSha256
        )
          throw new Error("Missing or changed user approval");
        if (run.status === "DONE") return run;
        return await approveMemory(fs, run.id, task.decision, ctx);
      }
      throw new Error("Unknown queue task kind");
    } finally {
      await stream?.finish();
      if (timer) clearInterval(timer);
      await polling;
      if (this.active.get(task.runId) === control)
        this.active.delete(task.runId);
      try {
        if (locked)
          await connection.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [`ruwen:project:${task.projectId}`],
          );
      } finally {
        if (!released) connection.release();
      }
    }
  }
  private async dispatch(
    fs: PostgresFS,
    id: string,
    value: Data,
    ctx: PipelineContext,
    status: string,
  ) {
    if (["AWAITING_PREVIEW_APPROVAL", "FAILED", "CANCELLED"].includes(status))
      return;
    const compiling = value.kind === "compile_request";
    const role = compiling
      ? "zhangjie-qingjing-bianyiyuan"
      : (value.recipient as RoleId);
    if (!compiling && !DISPATCH_ROLES.includes(role))
      throw new Error("Unsupported handoff recipient");
    const errors = compiling ? [] : await handoff.validateHandoff(value);
    if (errors.length) throw new Error(errors.join("；"));
    const run: ChapterRun = {
      id,
      projectKey: ctx.projectKey,
      chapter: "",
      target: "",
      status: "REQUESTED",
      paths: {},
      roles: {},
      costTotal: 0,
      events: [],
    };
    try {
      if (ctx.signal?.aborted) throw new RoleAbortError("Dispatch cancelled");
      const declaredScope =
        value.scope &&
        typeof value.scope === "object" &&
        !Array.isArray(value.scope)
          ? value.scope
          : {};
      const scope: Data = {
        project: ctx.projectKey,
        volume: null,
        arc: null,
        chapter: null,
        scene_type: null,
        pov: null,
        ...declaredScope,
      };
      const input: Data = {
        brief: value.payload ?? null,
        scope,
        resource_ids: value.resource_ids ?? [],
      };
      if (compiling) {
        const ready = await checks.projectReadiness(fs);
        if (!ready.ready) throw new Error(ready.errors.join("；"));
        const current = await state.loadState(fs);
        if (current.pending_consolidation)
          throw new Error(
            "Approved chapter still requires memory consolidation",
          );
        for (const ref of [
          current.active_outline,
          ...current.tracked_sources,
        ]) {
          if (!ref || typeof ref !== "object" || Array.isArray(ref))
            throw new Error("Missing approved compilation source");
          if (await state.currentRefReason(fs, ref, "compile source"))
            throw new Error("Compilation sources became stale");
        }
        const resources = await authorizedResourceInputs({ ...ctx, fs }, role);
        delete input.brief;
        delete input.resource_ids;
        Object.assign(input, {
          chapter: value.chapter,
          resources,
          approved_story:
            resources.find((r) => r.path === "故事/当前故事弧.md") ?? null,
          locked_events: value.locked_events,
          locked_order: value.locked_order,
        });
      }
      const result = await this.cachedRole(fs, run, role, input, {
        ...ctx,
        fs,
      });
      if (ctx.signal?.aborted) throw new RoleAbortError("Dispatch cancelled");
      await fs.transaction(async (tx) => {
        const output = `authoring-ruwen-v5/reports/dispatch/${id}.json`;
        await tx.write(output, JSON.stringify(publicRoleResult(result)));
        await tx.sql(
          "INSERT INTO previews(id,project_id,kind,payload,status) VALUES($1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING",
          [id, fs.projectId, role, JSON.stringify(result.output)],
        );
        await tx.sql(
          "UPDATE pipeline_runs SET status='AWAITING_PREVIEW_APPROVAL' WHERE id=$1",
          [id],
        );
        await tx.sql(
          "INSERT INTO pipeline_steps(run_id,step,status,output_ref,finished_at) VALUES($1,'PREVIEW_READY','completed',$2,now()) ON CONFLICT DO NOTHING",
          [id, JSON.stringify({ path: output })],
        );
        await tx.sql("SELECT pg_notify('ruwen_runs',$1)", [
          JSON.stringify({
            projectId: fs.projectId,
            runId: id,
            status: "AWAITING_PREVIEW_APPROVAL",
          }),
        ]);
        await this.options.onBoundary?.("checkpoint", "PREVIEW_READY", id);
      });
    } catch (error) {
      await fs.transaction(async (tx) => {
        await tx.sql(
          "UPDATE pipeline_runs SET status=$2,finished_at=now() WHERE id=$1",
          [id, error instanceof RoleAbortError ? "CANCELLED" : "FAILED"],
        );
        await tx.sql(
          "INSERT INTO pipeline_steps(run_id,step,status,error,finished_at) VALUES($1,'DISPATCH','failed',$2,now()) ON CONFLICT DO NOTHING",
          [id, (error as Error).message],
        );
      });
    }
  }
}

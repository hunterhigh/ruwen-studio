import { randomUUID } from "node:crypto";
import {
  assemblePrompt,
  type Data,
  ideationRoleSpec,
  RoleAbortError,
  RoleExecutionError,
  RoleProviderError,
  type RoleResult,
  RoleSecurityError,
  runRole,
} from "@ruwen/agents";
import { settleRole } from "@ruwen/billing";
import { publicRoleResult } from "@ruwen/core";
import { type Database, PostgresFS } from "@ruwen/db";
import type {
  IdeationActor,
  IdeationErrorCode,
  IdeationMessageId,
  IdeationRole,
  IdeationRunId,
  IdeationTaskStatus,
} from "@ruwen/pipeline";
import type { PgBoss } from "pg-boss";
import { rawCoordinatorSources } from "../../../packages/pipeline/src/ideation/backend.ts";
import {
  assertNoOriginalWording,
  OriginalWordingStream,
} from "../../../packages/pipeline/src/ideation/privacy.ts";
import {
  appendIdeationEvent,
  IdeationFailure,
  type IdeationSessionOptions,
  ideationDigest,
  ideationError,
} from "../../../packages/pipeline/src/ideation/sessions.ts";
import type { IdeationTransaction } from "../../../packages/pipeline/src/ideation/store.ts";
import { ideationSql } from "./ideation-billing.ts";
import { createIdeationService } from "./ideation-service.ts";
import { persistPrivatePrompt } from "./private-prompts.ts";
import { recordRoleSecurityEvents } from "./security-events.ts";
import type { Task, WorkerOptions } from "./service.ts";

const coordinatorRole = "chuangyi-xietiaoyuan" as const;
export class IdeationRunner {
  private db: Database;
  private boss: PgBoss;
  private options: WorkerOptions;
  private queue: string;
  private sessions: IdeationSessionOptions;
  private timer: ReturnType<typeof setInterval> | undefined;
  private publishing: Promise<void> | undefined;
  private active = new Map<string, AbortController>();
  constructor(
    db: Database,
    boss: PgBoss,
    queue: string,
    options: WorkerOptions,
  ) {
    this.db = db;
    this.boss = boss;
    this.queue = queue;
    this.options = options;
    this.sessions = {
      ...options.ideation,
      queue,
      modelMode: options.runtime().mode,
    };
  }
  start() {
    const publish = () => {
      if (this.publishing) return;
      this.publishing = this.publish()
        .catch(() => {
          this.options.onError?.(
            new Error("Ideation outbox publication failed"),
          );
        })
        .finally(() => {
          this.publishing = undefined;
        });
    };
    this.timer = setInterval(publish, 250);
    publish();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    for (const control of this.active.values()) control.abort();
    await this.publishing;
  }
  private async publish() {
    const rows = await this.db.pool.query<{
      run_id: string;
      project_id: string;
      owner_id: string;
    }>(
      "SELECT o.run_id,t.project_id,p.owner_id FROM ideation_outbox o JOIN ideation_tasks t ON t.run_id=o.run_id JOIN projects p ON p.id=t.project_id WHERE o.queue_name=$1 ORDER BY o.created_at LIMIT 16",
      [this.queue],
    );
    for (const row of rows.rows) {
      const fs = new PostgresFS(this.db, row.project_id, row.owner_id);
      await fs.transaction(async (tx) => {
        const pending = await tx.sql(
          "SELECT 1 FROM ideation_outbox WHERE run_id=$1 AND queue_name=$2 FOR UPDATE",
          [row.run_id, this.queue],
        );
        if (!pending.rowCount) return;
        const task: Task = {
          kind: "ideation",
          projectId: row.project_id,
          ownerId: row.owner_id,
          runId: row.run_id,
        };
        const queued = await this.boss.send(this.queue, task, {
          singletonKey: `${row.run_id}:ideation`,
          db: { executeSql: (query, values) => tx.sql(query, values) },
        });
        if (!queued) throw new Error("Ideation task was not enqueued");
        await tx.sql("DELETE FROM ideation_outbox WHERE run_id=$1", [
          row.run_id,
        ]);
      });
    }
  }
  async handle(job: Task, jobSignal?: AbortSignal) {
    let role: IdeationRole = coordinatorRole;
    const actor = {
      projectId: job.projectId,
      userId: job.ownerId,
    } as IdeationActor;
    const service = createIdeationService(this.db, this.sessions),
      fs = new PostgresFS(this.db, job.projectId, job.ownerId);
    const lock = await this.db.pool.connect();
    let locked = false;
    const control = new AbortController();
    const signal = jobSignal
      ? AbortSignal.any([jobSignal, control.signal])
      : control.signal;
    let cancellation: Promise<void> | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let eventTail = Promise.resolve();
    let eventError: unknown;
    let completedResult: RoleResult | undefined;
    let requestGuardFailure: IdeationFailure | undefined;
    let createdIntent = false;
    let providerStarted = false;
    const event = (
      sessionId: string,
      data: Parameters<typeof appendIdeationEvent>[4],
    ) => {
      eventTail = eventTail
        .then(async () => {
          if (eventError) return;
          await service.store.transaction(actor, (tx) =>
            appendIdeationEvent(tx, actor, sessionId, job.runId, data),
          );
        })
        .catch((error) => {
          eventError = error;
          control.abort();
        });
    };
    try {
      locked =
        (
          await lock.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
            [`ruwen:project:${job.projectId}`],
          )
        ).rows[0]?.locked === true;
      if (!locked) {
        const queued = await this.boss.sendAfter(
          this.queue,
          { ...job, lockDeferrals: (job.lockDeferrals ?? 0) + 1 },
          { singletonKey: `${job.runId}:ideation` },
          new Date(
            Date.now() +
              Math.min(30000, 250 * 2 ** Math.min(job.lockDeferrals ?? 0, 7)),
          ),
        );
        if (!queued) throw new Error("Could not defer ideation task");
        return;
      }
      this.active.set(job.runId, control);
      const task = await service.store.transaction(actor, (tx) =>
        service.ownedTask(tx, actor, job.runId),
      );
      if (
        [
          "SUCCEEDED",
          "FAILED",
          "CANCELLED",
          "INTERRUPTED",
          "AWAITING_PREVIEW_APPROVAL",
          "AWAITING_LEARNING_PLAN_APPROVAL",
        ].includes(task.status)
      )
        return;
      role = task.role;
      const coordinator = role === coordinatorRole;
      if (coordinator && task.stage !== "coordinator")
        throw new IdeationFailure("PRECONDITION_FAILED");
      const execution = coordinator
        ? undefined
        : await service.executionInput(actor, job.runId);
      const initial = coordinator
        ? await service.coordinatorInput(actor, job.runId)
        : execution?.input;
      if (!initial) throw new IdeationFailure("PRECONDITION_FAILED");
      const runtime =
        this.options.runtimeForRequest?.({ sessionId: task.sessionId }) ??
        this.options.runtime();
      if (runtime.mode !== this.sessions.modelMode)
        throw new IdeationFailure("PRECONDITION_FAILED");
      let intent = false;
      await service.store.transaction(actor, async (tx) => {
        const row = await tx.sql(
          "SELECT 1 FROM role_runs WHERE run_id=$1 AND role_id=$2",
          [job.runId, role],
        );
        if (row.rowCount) throw new IdeationFailure("INTERRUPTED");
        const spec = ideationRoleSpec(role, execution?.phase);
        const prompt = await assemblePrompt(spec);
        const route = runtime.resolve(spec);
        await tx.sql(
          "INSERT INTO prompts(sha256,content) VALUES($1,$2) ON CONFLICT DO NOTHING",
          [prompt.sha256, prompt.content],
        );
        // No wording/transcript snapshots. The DB boundary is stable across recovery.
        await tx.sql(
          "INSERT INTO role_runs(run_id,role_id,status,input_sha256,model,prompt_sha256) VALUES($1,$2,'running',$3,$4,$5)",
          [
            job.runId,
            role,
            ideationDigest(initial),
            `${route.model.provider}/${route.model.id}`,
            prompt.sha256,
          ],
        );
        await tx.sql(
          "UPDATE pipeline_runs SET status='RUNNING' WHERE id=$1 AND project_id=$2",
          [job.runId, actor.projectId],
        );
        await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
          type: "task_changed",
          taskId: task.id,
          status: "RUNNING",
        });
        intent = true;
        createdIntent = true;
      });
      if (!intent) return;
      await this.options.onBoundary?.("role_intent", role, job.runId);
      const poll = () => {
        if (cancellation) return;
        cancellation = this.db.pool
          .query<{ cancel_requested: boolean }>(
            "SELECT cancel_requested FROM pipeline_runs WHERE id=$1 AND project_id=$2",
            [job.runId, actor.projectId],
          )
          .then((row) => {
            if (row.rows[0]?.cancel_requested) control.abort();
          })
          .finally(() => {
            cancellation = undefined;
          });
      };
      timer = setInterval(poll, 100);
      poll();
      const raw = await service.store.transaction(actor, async (tx) => {
        const boundary = (
          await tx.sql<{ session_revision: number }>(
            "SELECT session_revision FROM ideation_tasks WHERE run_id=$1",
            [task.id],
          )
        ).rows[0]?.session_revision;
        return rawCoordinatorSources(tx, actor, task.sessionId, boundary);
      });
      const wording = new OriginalWordingStream(raw, (text) =>
        event(task.sessionId, { type: "delta", role, text: text as never }),
      );
      let hiddenQuote = false;
      let result: RoleResult;
      try {
        result = await runRole(role, initial, {
          onRequest: () => {
            providerStarted = true;
          },
          ...(execution?.phase ? { ideationPhase: execution.phase } : {}),
          fs,
          projectId: actor.projectId,
          projectKey: String(
            coordinator
              ? (initial.project_state as Data).project
              : (initial.scope as Data).project,
          ),
          runtime,
          signal,
          timeoutMs: this.options.roleTimeoutMs ?? 600000,
          ...(coordinator
            ? {
                loadCoordinatorInput: async () => {
                  try {
                    return await service.coordinatorInput(actor, job.runId);
                  } catch (error) {
                    if (error instanceof IdeationFailure)
                      requestGuardFailure = error;
                    throw error;
                  }
                },
              }
            : {
                onResourceRead: (resource: Data) => {
                  try {
                    assertNoOriginalWording(resource, raw);
                  } catch (error) {
                    if (error instanceof IdeationFailure)
                      requestGuardFailure = error;
                    throw error;
                  }
                },
              }),
          ...(execution?.search
            ? { search: execution.search, searchApproved: true }
            : {}),
          ...(!coordinator
            ? {
                beforeProviderRequest: async () => {
                  try {
                    if (requestGuardFailure) throw requestGuardFailure;
                    await service.executionInput(actor, job.runId);
                  } catch (error) {
                    if (error instanceof IdeationFailure)
                      requestGuardFailure = error;
                    throw error;
                  }
                },
                onToolMaterial: (material: Data) => {
                  try {
                    assertNoOriginalWording(material, raw);
                  } catch (error) {
                    if (error instanceof IdeationFailure)
                      requestGuardFailure = error;
                    throw error;
                  }
                },
              }
            : {}),
          onPrompt: (prompt) => persistPrivatePrompt(fs, prompt),
          onDelta: (text) => {
            if (!wording.push(text)) hiddenQuote = true;
          },
          onAttemptReset: (_role, reason) => {
            wording.reset();
            hiddenQuote = false;
            event(task.sessionId, { type: "reset", role, reason });
          },
        });
      } catch (error) {
        await eventTail;
        if (error instanceof RoleExecutionError && error.partial)
          await this.saveFailedRole(
            service,
            actor,
            task.id,
            error.partial,
            role,
            !requestGuardFailure &&
              (error instanceof RoleAbortError ||
                error instanceof RoleProviderError),
            Boolean(requestGuardFailure),
          );
        throw error;
      }
      completedResult = result;
      if (requestGuardFailure) throw requestGuardFailure;
      wording.finish();
      if (hiddenQuote && !coordinator)
        throw new IdeationFailure("OUTPUT_BLOCKED");
      if (hiddenQuote) {
        event(task.sessionId, {
          type: "reset",
          role,
          reason: "security_refusal",
        });
        event(task.sessionId, {
          type: "delta",
          role,
          text: "回复已保存，请在会话中查看。" as never,
        });
      }
      await eventTail;
      if (eventError) throw eventError;
      await this.options.onBoundary?.("role_response", role, job.runId);
      await service.store.transaction(actor, async (tx) => {
        const current = await service.ownedTask(tx, actor, job.runId);
        for (const read of result.readResources) {
          if ((await tx.sha256(read.path)) !== read.sha256)
            throw new IdeationFailure("RESOURCE_STALE");
        }
        const cancelled = (
          await tx.sql<{ cancel_requested: boolean }>(
            "SELECT cancel_requested FROM pipeline_runs WHERE id=$1",
            [job.runId],
          )
        ).rows[0]?.cancel_requested;
        const preview =
          typeof result.output === "object" && !cancelled
            ? coordinator
              ? await service.saveHandoff(tx, actor, current, result.output)
              : await service.saveDownstream(tx, actor, current, result)
            : null;
        const content =
          typeof result.output === "string"
            ? result.output
            : (preview?.summary ?? "本次回合已取消。");
        const messageId = randomUUID() as IdeationMessageId;
        const revision = (
          await tx.sql<{ session_revision: number }>(
            "SELECT session_revision FROM ideation_tasks WHERE run_id=$1",
            [job.runId],
          )
        ).rows[0]?.session_revision;
        if (coordinator)
          await tx.sql(
            "INSERT INTO ideation_messages(id,project_id,session_id,turn_id,role,content,session_revision) VALUES($1,$2,$3,$4,'assistant',$5,$6)",
            [
              messageId,
              actor.projectId,
              task.sessionId,
              task.id,
              JSON.stringify(content),
              revision,
            ],
          );
        await this.saveRole(tx, actor, job.runId, result, "completed", role);
        const status = cancelled
          ? "CANCELLED"
          : coordinator
            ? "SUCCEEDED"
            : task.stage === "learning_plan"
              ? "AWAITING_LEARNING_PLAN_APPROVAL"
              : "AWAITING_PREVIEW_APPROVAL";
        await tx.sql(
          "UPDATE pipeline_runs SET status=$2,finished_at=CASE WHEN $2 IN ('SUCCEEDED','CANCELLED') THEN now() ELSE NULL END WHERE id=$1",
          [job.runId, status],
        );
        if (cancelled || coordinator)
          await service.options.onTaskTerminal?.(tx, actor, task.id);
        await tx.sql(
          "UPDATE ideation_sessions SET current_turn_id=NULL,updated_at=now() WHERE id=$1 AND current_turn_id=$2",
          [task.sessionId, job.runId],
        );
        await tx.sql(
          "INSERT INTO pipeline_steps(run_id,step,status,output_ref,finished_at) VALUES($1,'coordinator_complete','completed',$2,now()) ON CONFLICT DO NOTHING",
          [
            job.runId,
            JSON.stringify({ messageId, previewId: preview?.id ?? null }),
          ],
        );
        if (coordinator)
          await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
            type: "message_changed",
            messageId,
            turnId: task.id,
            status: "complete",
          });
        await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
          type: "task_changed",
          taskId: task.id,
          status,
        });
      });
      await this.options.onBoundary?.("role_completed", role, job.runId);
    } catch (error) {
      if (completedResult)
        await this.saveFailedRole(
          service,
          actor,
          job.runId as IdeationRunId,
          completedResult,
          role,
        );
      const code: IdeationErrorCode = requestGuardFailure
        ? requestGuardFailure.code
        : eventError
          ? "INTERNAL_ERROR"
          : error instanceof IdeationFailure
            ? error.code
            : signal.aborted
              ? "CANCELLED"
              : error instanceof RoleSecurityError
                ? "OUTPUT_BLOCKED"
                : error instanceof RoleProviderError
                  ? "PROVIDER_UNAVAILABLE"
                  : error instanceof RoleExecutionError
                    ? "CREATION_CHECK_FAILED"
                    : "INTERRUPTED";
      // A crash at a committed completion boundary is harmless; never downgrade saved work.
      await service.store.transaction(actor, async (tx) => {
        const task = await service.ownedTask(tx, actor, job.runId);
        if (
          [
            "SUCCEEDED",
            "CANCELLED",
            "FAILED",
            "INTERRUPTED",
            "AWAITING_PREVIEW_APPROVAL",
            "AWAITING_LEARNING_PLAN_APPROVAL",
          ].includes(task.status)
        )
          return;
        const status: IdeationTaskStatus =
          code === "CANCELLED"
            ? "CANCELLED"
            : code === "INTERRUPTED"
              ? "INTERRUPTED"
              : "FAILED";
        await tx.sql(
          "UPDATE pipeline_runs SET status=$2,finished_at=now() WHERE id=$1",
          [job.runId, status],
        );
        // Only this live invocation can prove it never called a provider. A recovered intent cannot.
        if (createdIntent && !providerStarted)
          await tx.sql(
            "UPDATE role_runs SET status='blocked',usage='[]',usage_unknown=false,cost_usd=0,transcript='[]',finished_at=now() WHERE run_id=$1 AND status='running'",
            [job.runId],
          );
        await service.options.onTaskTerminal?.(tx, actor, task.id);
        await tx.sql("UPDATE ideation_tasks SET error=$2 WHERE run_id=$1", [
          job.runId,
          JSON.stringify(ideationError(code)),
        ]);
        await tx.sql(
          "UPDATE ideation_sessions SET current_turn_id=NULL WHERE id=$1 AND current_turn_id=$2",
          [task.sessionId, job.runId],
        );
        await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
          type: "task_changed",
          taskId: task.id,
          status,
        });
        await appendIdeationEvent(tx, actor, task.sessionId, task.id, {
          type: "error",
          error: ideationError(code),
        });
      });
    } finally {
      if (timer) clearInterval(timer);
      await cancellation;
      await eventTail;
      this.active.delete(job.runId);
      try {
        if (locked)
          await lock.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [`ruwen:project:${job.projectId}`],
          );
      } finally {
        lock.release();
      }
    }
  }
  private async saveRole(
    tx: IdeationTransaction,
    actor: IdeationActor,
    runId: string,
    result: RoleResult,
    status: string,
    role: IdeationRole,
    usageUnknown = false,
    blockedBeforeRequest = false,
  ) {
    if (!Number.isFinite(result.costTotal) || result.costTotal < 0)
      throw new Error("Invalid reported role cost");
    const safe = {
      ...publicRoleResult(result),
      output: "",
      transcript: [],
    } as unknown as RoleResult;
    const changed = await tx.sql<{ id: string }>(
      "UPDATE role_runs SET status=$3,result=$4,transcript='[]',usage=$5,cost_usd=$6,cache_read_tokens=$7,cache_write_tokens=$8,usage_unknown=$9,finished_at=now() WHERE run_id=$1 AND role_id=$2 AND status='running' RETURNING id",
      [
        runId,
        role,
        blockedBeforeRequest && !result.usage.length ? "blocked" : status,
        JSON.stringify(safe),
        JSON.stringify(result.usage),
        !usageUnknown && (result.usage.length || blockedBeforeRequest)
          ? result.costTotal
          : null,
        result.usage.reduce((n, u) => n + u.cacheRead, 0),
        result.usage.reduce((n, u) => n + u.cacheWrite, 0),
        usageUnknown || (!result.usage.length && !blockedBeforeRequest),
      ],
    );
    await recordRoleSecurityEvents(tx as PostgresFS, runId, role, result);
    if (changed.rows[0] && result.usage.length) {
      await tx.sql(
        "INSERT INTO role_cost_events(role_run_id,cost_usd) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [changed.rows[0].id, result.costTotal],
      );
      await settleRole(
        ideationSql(tx),
        actor.userId,
        runId,
        changed.rows[0].id,
      );
    }
  }
  private async saveFailedRole(
    service: ReturnType<typeof createIdeationService>,
    actor: IdeationActor,
    runId: IdeationRunId,
    result: RoleResult,
    role: IdeationRole,
    usageUnknown = false,
    blockedBeforeRequest = false,
  ) {
    // Failed output may contain a rejected source quote. Store usage and metadata only.
    await service.store.transaction(actor, (tx) =>
      this.saveRole(
        tx,
        actor,
        runId,
        { ...result, output: "", transcript: [] },
        "failed",
        role,
        usageUnknown,
        blockedBeforeRequest,
      ),
    );
  }
}

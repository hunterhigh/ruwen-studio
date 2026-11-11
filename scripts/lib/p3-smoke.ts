import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createIdeationService } from "../../apps/worker/src/ideation-service.ts";
import { runtimeSettings } from "../../config/settings.ts";
import {
  defaultFauxResponse,
  requestRole,
} from "../../packages/agents/src/faux.ts";
import {
  createApplicationRuntime,
  createFauxRuntime,
  type ModelRuntime,
  ROLES,
  type RoleId,
  type RoleResult,
} from "../../packages/agents/src/index.ts";
import { modelProfile } from "../../packages/agents/src/model-profile.ts";
import {
  resolveCatalogModel,
  roleGenerationPolicy,
} from "../../packages/agents/src/models.ts";
import { localResponse } from "../../packages/agents/src/runtime/local-response.ts";
import type {
  IdeationActor,
  IdeationPreview,
  IdeationResult,
  IdeationRunId,
} from "../../packages/pipeline/src/ideation/contract.ts";
import { loadRun } from "../../packages/pipeline/src/index.ts";
import { isolatedProject } from "./isolated-project.ts";
import {
  requestCostBound,
  requestInputBound,
  SmokeBudget,
} from "./smoke-budget.ts";

const value = <T>(result: IdeationResult<T>): T => {
  if (!result.ok) throw new Error(`Ideation: ${result.error.code}`);
  return result.value;
};
function demoReplies() {
  let conversations = 0;
  return (
    context: Parameters<typeof defaultFauxResponse>[0],
  ): ReturnType<typeof defaultFauxResponse> => {
    if (
      requestRole(context) === "chuangyi-xietiaoyuan" &&
      conversations++ === 0
    )
      return {
        ...defaultFauxResponse(context),
        content: [
          {
            type: "text",
            text: "可以先讨论驿站里各方的利益，再由你决定是否交接。",
          },
        ],
        stopReason: "stop",
      };
    return defaultFauxResponse(context);
  };
}
export function smokeFaux() {
  const reply = demoReplies();
  return createFauxRuntime(Array.from({ length: 100 }, () => reply));
}
export interface SmokeOptions {
  url: string;
  directory: string;
  mode: "record" | "replay";
  maxUsd?: number;
  live?: boolean;
  upstream?: ModelRuntime;
  /** Internal offline mode: local fixed replies only, no provider dispatch or recording. */
  planOnly?: boolean;
}
export async function runP3Smoke(options: SmokeOptions) {
  const directory = path.resolve(options.directory);
  if (!options.planOnly) await mkdir(directory, { recursive: true });
  const planFile = path.join(directory, "smoke-plan.json");
  const plan =
    options.mode === "replay"
      ? (JSON.parse(await readFile(planFile, "utf8")) as {
          version: number;
          upstream: string;
        })
      : { version: 1, upstream: options.live ? "real" : "faux" };
  if (plan.version !== 1 || !["real", "faux"].includes(plan.upstream))
    throw new Error("Unsupported smoke recording plan");
  if (options.mode === "record" && !options.planOnly)
    await writeFile(planFile, `${JSON.stringify(plan, null, 2)}\n`, {
      flag: "wx",
    });
  const upstream = options.planOnly
    ? undefined
    : (options.upstream ??
      (plan.upstream === "faux" ? smokeFaux() : undefined));
  const fixed = options.planOnly ? createFauxRuntime([]) : undefined;
  let base =
    fixed ??
    createApplicationRuntime({
      mode: options.mode,
      workspaceRoot: directory,
      ...(upstream ? { upstream } : {}),
    });
  const planned: {
    phase: string;
    role: string;
    model: string;
    inputBytes: number;
    framingTokens: number;
    inputTokens: number;
    outputTokens: number;
    boundUsd: number;
  }[] = [];
  let planningState: { callCount: number } | undefined;
  if (fixed) {
    planningState = fixed.faux.state;
    const respond = demoReplies();
    // Even an accidental delegation to this runtime fails before any faux provider call.
    fixed.models.streamSimple = () => {
      throw new Error("Planner cannot dispatch a provider");
    };
    const models = new Proxy(fixed.models, {
      get(target, key) {
        if (key === "streamSimple")
          return ((selected, context) => {
            const role = requestRole(
              context as Parameters<typeof requestRole>[0],
            );
            const { model } = resolveCatalogModel(ROLES[role]),
              outputTokens = Math.min(
                roleGenerationPolicy(role).maxTokens,
                model.maxTokens,
              ),
              input = requestInputBound(context);
            planned.push({
              phase: budget.phase,
              role,
              model: `${model.provider}/${model.id}`,
              inputBytes: input.utf8Bytes,
              framingTokens: input.framingTokens,
              inputTokens: input.tokens,
              outputTokens,
              boundUsd: requestCostBound(model, context, outputTokens),
            });
            const normalized = context as Parameters<
              typeof defaultFauxResponse
            >[0];
            const reply = respond(normalized);
            return localResponse({
              ...reply,
              api: selected.api,
              provider: selected.provider,
              model: selected.id,
            });
          }) as ModelRuntime["models"]["streamSimple"];
        if (
          [
            "stream",
            "complete",
            "completeSimple",
            "streamDeferred",
            "fetchDeferred",
          ].includes(String(key))
        )
          return () => {
            throw new Error("Planner cannot dispatch a provider");
          };
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    base = { ...fixed, models };
  }
  const budget = new SmokeBudget(options.maxUsd ?? 5),
    runtime = budget.wrap(base);
  const steps: { phase: string; status: string }[] = [];
  let failure: string | null = null,
    candidate = "",
    memoryPreview: unknown = null;
  let results: { role: RoleId; result: RoleResult }[] = [];
  const project = await isolatedProject(options.url, runtime);
  const { service: worker, fs } = project;
  let retries: { role: string; count: string }[] = [];
  try {
    // This is a disposable tool account, not production charging. Only its sandbox ledger is funded.
    const billing = runtimeSettings().billing;
    const credits =
      Math.ceil(budget.capUsd * billing.creditsPerUsd * billing.costMarkup) +
      Object.values(billing.defaultReservations).reduce((a, b) => a + b, 0) * 5;
    await worker.db.pool.query(
      "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'sandbox',$2,'test_fixture','user',$3)",
      [fs.ownerId, credits, fs.ownerId],
    );
    const actor = {
      userId: fs.ownerId,
      projectId: fs.projectId,
    } as IdeationActor;
    // Provider mode is recorded; admission/settlement uses the isolated sandbox bank only.
    const service = createIdeationService(worker.db, {
      modelMode: "faux",
      queue: worker.queue,
    });
    const session = value(
      await service.createIdeationSession(actor, {
        clientRequestId: randomUUID() as never,
      }),
    );
    const handle = async (runId: IdeationRunId, phase: string) => {
      budget.phase = phase;
      await worker.handle({
        kind: "ideation",
        projectId: fs.projectId,
        ownerId: fs.ownerId,
        runId,
      });
      const task = value(
        await service.getIdeationTask(actor, { taskId: runId }),
      );
      steps.push({ phase, status: task.status });
      if (!["SUCCEEDED", "AWAITING_PREVIEW_APPROVAL"].includes(task.status))
        throw new Error(`Stopped ${phase}: ${task.error?.code ?? task.status}`);
    };
    const send = async (content: string, revision: number, phase: string) => {
      const accepted = value(
        await service.sendIdeationMessage(actor, {
          sessionId: session.id,
          content,
          expectedSessionRevision: revision,
          clientRequestId: randomUUID() as never,
        }),
      );
      await handle(accepted.turnId, phase);
    };
    const pending = async (kind: IdeationPreview["kind"]) => {
      const preview = value(
        await service.listPreviews(actor, {
          sessionId: session.id,
          status: "pending",
        }),
      ).items.find((p) => p.kind === kind);
      if (!preview) throw new Error(`Missing ${kind} preview`);
      return preview;
    };
    const approve = async (preview: IdeationPreview) =>
      value(
        await service.approvePreview(actor, {
          previewId: preview.id,
          expectedSha256: preview.sha256,
          confirmed: true,
          clientRequestId: randomUUID() as never,
        }),
      );
    await send(
      "想先讨论驿站中送信人与粮车的冲突，不固定人物的决定。",
      0,
      "conversation",
    );
    await send(
      "请把尚未解决的关系压力整理成干净委托，交给故事构思师。",
      1,
      "communication_gate",
    );
    const handoff = await pending("handoff");
    const dispatched = await approve(handoff);
    if (!dispatched.startedTaskId) throw new Error("Handoff did not dispatch");
    await handle(dispatched.startedTaskId, "downstream_preview");
    await pending("file_patch");
    const compile = value(
      await service.requestIdeationCompilation(actor, {
        sessionId: session.id,
        clientRequestId: randomUUID() as never,
        chapter: "001",
        scope: {
          volume: "v1",
          arc: "station",
          scene_type: "travel",
          pov: "林川",
        },
        sources: [],
      }),
    );
    await handle(compile.id, "compilation");
    await approve(await pending("generation_field"));
    budget.phase = "chapter";
    // enqueueChapter's public API uses MODEL_MODE only to select its bank. CLI pins it to faux.
    if (["real", "record"].includes(process.env.MODEL_MODE ?? ""))
      throw new Error(
        "Smoke sandbox requires MODEL_MODE=faux (transport remains recorded)",
      );
    const runId = await worker.enqueueChapter(fs, { chapter: "001" });
    await worker.handle({
      kind: "chapter",
      projectId: fs.projectId,
      ownerId: fs.ownerId,
      runId,
    });
    let run = await loadRun(fs, runId);
    steps.push({ phase: "chapter", status: run.status });
    if (run.paths.candidate && (await fs.exists(run.paths.candidate)))
      candidate = await fs.readText(run.paths.candidate);
    if (run.status !== "AWAITING_CANDIDATE_APPROVAL" || !run.candidateSha256)
      throw new Error(run.error ?? `Chapter stopped: ${run.status}`);
    budget.phase = "memory_preview";
    const decision = {
      confirmed: true as const,
      expectedSha256: run.candidateSha256,
      ...(run.targetBeforeSha256
        ? { expectedTargetSha256: run.targetBeforeSha256 }
        : {}),
    };
    await worker.enqueueApproval(fs, runId, "candidate", decision);
    await worker.handle({
      kind: "candidate",
      projectId: fs.projectId,
      ownerId: fs.ownerId,
      runId,
      decision,
    });
    await worker.handle({
      kind: "memory_preview",
      projectId: fs.projectId,
      ownerId: fs.ownerId,
      runId,
    });
    run = await loadRun(fs, runId);
    steps.push({ phase: "memory_preview", status: run.status });
    if (run.paths.memory_preview && (await fs.exists(run.paths.memory_preview)))
      memoryPreview = JSON.parse(await fs.readText(run.paths.memory_preview));
    if (run.status !== "AWAITING_MEMORY_APPROVAL")
      throw new Error(run.error ?? `Memory stopped: ${run.status}`);
    // Intentionally no memory approval: the final product of this smoke is a preview.
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    results = (
      await worker.db.pool.query<{ role: RoleId; result: RoleResult }>(
        "SELECT role_id AS role,result FROM role_runs WHERE run_id IN (SELECT id FROM pipeline_runs WHERE project_id=$1) AND result IS NOT NULL ORDER BY id",
        [fs.projectId],
      )
    ).rows;
    retries = (
      await worker.db.pool.query<{ role: string; count: string }>(
        `SELECT role,count(*)::text FROM (
      SELECT role_id AS role FROM web_run_events WHERE project_id=$1 AND event_type='reset' AND reset_reason IN ('format_correction','prompt_overlap_correction')
      UNION ALL SELECT data->>'role' AS role FROM ideation_events WHERE project_id=$1 AND data->>'type'='reset' AND data->>'reason' IN ('format_correction','prompt_overlap_correction')) r GROUP BY role`,
        [fs.projectId],
      )
    ).rows;
    await worker.stop();
  }
  const roles = [...new Set(budget.calls.map((c) => c.role))].map((role) => {
    const calls = budget.calls.filter((c) => c.role === role);
    const usage = calls.flatMap((c) => (c.usage ? [c.usage] : []));
    const sum = (
      key: "input" | "output" | "cacheRead" | "cacheWrite" | "totalTokens",
    ) => usage.reduce((n, u) => n + u[key], 0);
    return {
      role,
      inputTokens: sum("input"),
      outputTokens: sum("output"),
      cacheReadTokens: sum("cacheRead"),
      cacheWriteTokens: sum("cacheWrite"),
      totalTokens: sum("totalTokens"),
      costUsd: usage.reduce((n, u) => n + u.cost.total, 0),
      durationMs: results
        .filter((r) => r.role === role)
        .reduce((n, r) => n + r.result.durationMs, 0),
      providerDurationMs: calls.reduce((n, c) => n + c.durationMs, 0),
      retries: Number(retries.find((r) => r.role === role)?.count ?? 0),
      truncated: calls.some((c) => c.stopReason === "length"),
      failures: calls.flatMap((c) =>
        c.failureOriginal ? [c.failureOriginal] : [],
      ),
    };
  });
  const report = {
    version: 1,
    profile: modelProfile(),
    mode: options.mode,
    upstream: plan.upstream,
    p3GatePassed: false,
    planned,
    providerCalls: planningState?.callCount ?? null,
    status: failure ? "failed" : "completed",
    failure,
    maxUsd: budget.capUsd,
    costUsd: budget.spentUsd,
    heldUsd: budget.heldUsd,
    budgetStopped: budget.stopped,
    steps,
    roles,
    calls: budget.calls,
    candidate,
    candidateDrafts: budget.calls
      .filter((c) => c.role === "xiaoshuo-zuozhe")
      .map((c) => ({
        status: c.status,
        stopReason: c.stopReason,
        response: c.recordedResponse,
      })),
    memoryPreview,
  };
  if (!options.planOnly) {
    await writeFile(
      path.join(directory, `report-${options.mode}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await writeFile(
      path.join(directory, `candidate-${options.mode}.md`),
      candidate,
    );
  }
  return report;
}

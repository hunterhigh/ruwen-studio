import type {
  IdeationActor,
  IdeationApprovalReceipt,
  IdeationErrorCode,
  IdeationEvent,
  IdeationEventData,
  IdeationMessage,
  IdeationMessageAccepted,
  IdeationPreview,
  IdeationRequestId,
  IdeationResult,
  IdeationRunId,
  IdeationSafeText,
  IdeationService,
  IdeationSession,
  IdeationSessionId,
  IdeationTask,
} from "@ruwen/pipeline";
import { errorCopy } from "./copy.ts";
import {
  fixtureBrand as b,
  previewFixture,
  researchFixture,
} from "./fixtures.ts";

/** Exact contract requests/results with server actor removed; this local demo never sends an actor over HTTP. */
export type IdeationClient = {
  [K in keyof IdeationService]: IdeationService[K] extends (
    actor: IdeationActor,
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Result
    : never;
};
export interface DemoTiming {
  resetMs: number;
  responseMs: number;
  chunkMs: number;
}
class DemoError extends Error {
  constructor(readonly code: IdeationErrorCode) {
    super(code);
  }
}
const now = () => new Date().toISOString();
const uuid = <T extends string>() => crypto.randomUUID() as T;
export const newRequestId = () => uuid<IdeationRequestId>();

/** Disposable UI model, not backend validation, authorization or an implementation of project writes. */
export function createIdeationDemo(
  projectId: string,
  timing: DemoTiming,
  chatLimit: number,
) {
  let sessions: IdeationSession[] = ["北岸冬信", "渡河之前"].map(
    (title, index) => ({
      id: b(`00000000-0000-4000-8000-00000000000${index + 1}`),
      projectId: b(projectId),
      title,
      status: "open",
      revision: 0,
      currentTurnId: null,
      capabilities: { externalSearch: false, modelMode: "faux" },
      createdAt: now(),
      updatedAt: now(),
    }),
  );
  const messages: IdeationMessage[] = [];
  const previews = new Map<IdeationPreview["id"], IdeationPreview>();
  const tasks = new Map<IdeationRunId, IdeationTask>();
  const decisions = new Map<
    IdeationApprovalReceipt["id"],
    IdeationApprovalReceipt
  >();
  const events: IdeationEvent[] = [];
  const listeners = new Set<(event: IdeationEvent) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const runs: { sessionId: IdeationSessionId; runId: IdeationRunId }[] = [];
  const requests = new Map<string, { signature: string; result: unknown }>();
  let cursor = 0n;
  const session = (id: IdeationSessionId) => {
    const row = sessions.find((item) => item.id === id);
    if (!row) throw new DemoError("NOT_FOUND");
    return row;
  };
  const open = (id: IdeationSessionId) => {
    const row = session(id);
    if (row.status === "closed") throw new DemoError("SESSION_CLOSED");
    return row;
  };
  const updateSession = (
    id: IdeationSessionId,
    patch: Partial<IdeationSession>,
  ) => {
    sessions = sessions.map((row) =>
      row.id === id ? { ...row, ...patch, updatedAt: now() } : row,
    );
  };
  const later = (ms: number, callback: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, ms);
    timers.add(timer);
  };
  function emit(
    sessionId: IdeationSessionId,
    runId: IdeationRunId | null,
    data: IdeationEventData,
  ) {
    const event: IdeationEvent = {
      ...data,
      version: 1,
      id: b(String(++cursor)),
      projectId: b(projectId),
      sessionId,
      runId,
      createdAt: now(),
    };
    events.push(event);
    for (const listener of listeners) listener(event);
  }
  function addMessage(
    sessionId: IdeationSessionId,
    content: string,
    turnId: IdeationRunId | null,
    role: IdeationMessage["role"] = "user",
  ) {
    const message: IdeationMessage = {
      id: uuid(),
      projectId: b(projectId),
      sessionId,
      turnId,
      role,
      content,
      status: "complete",
      createdAt: now(),
    };
    messages.push(message);
    // Event metadata contains no original wording.
    if (turnId)
      emit(sessionId, turnId, {
        type: "message_changed",
        messageId: message.id,
        turnId,
        status: message.status,
      });
    return message;
  }
  function task(
    sessionId: IdeationSessionId,
    role: IdeationTask["role"],
    stage: IdeationTask["stage"],
    sourcePreviewId: IdeationPreview["id"] | null = null,
  ): IdeationTask {
    const value: IdeationTask = {
      id: uuid(),
      projectId: b(projectId),
      sessionId,
      role,
      stage,
      status: "QUEUED",
      sourcePreviewId,
      outputPreviewIds: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: null,
      },
      error: null,
      createdAt: now(),
      finishedAt: null,
    };
    tasks.set(value.id, value);
    return value;
  }
  function changeTask(id: IdeationRunId, patch: Partial<IdeationTask>) {
    const old = tasks.get(id);
    if (!old) return;
    const value = { ...old, ...patch };
    tasks.set(id, value);
    emit(value.sessionId, id, {
      type: "task_changed",
      taskId: id,
      status: value.status,
    });
  }
  function addPreview(value: IdeationPreview) {
    previews.set(value.id, value);
    emit(value.sessionId, value.taskId, {
      type: "preview_changed",
      previewId: value.id,
      status: value.status,
      sha256: value.sha256,
    });
    return value;
  }
  function readyPreview(
    kind: IdeationPreview["kind"],
    sessionId: IdeationSessionId,
    run?: IdeationTask,
  ) {
    const value = previewFixture(kind, projectId, sessionId, run?.id ?? uuid());
    const job =
      run ??
      task(
        sessionId,
        value.role,
        kind === "learning_plan"
          ? "learning_plan"
          : kind === "expression_candidate"
            ? "expression"
            : kind === "generation_field"
              ? "compilation"
              : kind === "handoff"
                ? "coordinator"
                : "story",
      );
    const preview = { ...value, taskId: job.id };
    previews.set(preview.id, preview);
    tasks.set(job.id, {
      ...job,
      status:
        kind === "learning_plan"
          ? "AWAITING_LEARNING_PLAN_APPROVAL"
          : "AWAITING_PREVIEW_APPROVAL",
      outputPreviewIds: [preview.id],
    });
    return preview;
  }
  const first = sessions[0];
  if (first) {
    addMessage(
      first.id,
      "我们可以从北岸的来信开始。你想保留什么，又想把哪些选择留给人物？",
      null,
      "assistant",
    );
    for (const kind of [
      "handoff",
      "file_patch",
      "learning_plan",
      "expression_candidate",
      "generation_field",
    ] as const)
      readyPreview(kind, first.id);
    const interrupted = task(first.id, "waibu-zhishi-guwen", "research");
    tasks.set(interrupted.id, {
      ...interrupted,
      status: "INTERRUPTED",
      error: {
        code: "INTERRUPTED",
        message: b(errorCopy.INTERRUPTED),
        retryable: false,
        traceId: "demo-interrupted",
        issues: [],
      },
    });
  }
  function checkedPreview(
    request: {
      previewId: IdeationPreview["id"];
      expectedSha256: IdeationPreview["sha256"];
    },
    allowStale = false,
  ) {
    const preview = previews.get(request.previewId);
    if (!preview) throw new DemoError("NOT_FOUND");
    open(preview.sessionId);
    if (
      preview.sha256 !== request.expectedSha256 ||
      (!allowStale && preview.status === "stale")
    )
      throw new DemoError("PREVIEW_STALE");
    if (
      preview.status !== "pending" &&
      !(allowStale && preview.status === "stale")
    )
      throw new DemoError("ALREADY_DECIDED");
    return preview;
  }
  function validText(content: string) {
    if (!content.trim()) throw new DemoError("INVALID_ARGUMENT");
    if (Array.from(content).length > chatLimit)
      throw new DemoError("INPUT_LIMIT_EXCEEDED");
  }
  const perform = async <T>(
    callback: () => T | Promise<T>,
  ): Promise<IdeationResult<T>> => {
    try {
      return { ok: true, value: await callback() };
    } catch (error) {
      const code = error instanceof DemoError ? error.code : "INTERNAL_ERROR";
      return {
        ok: false,
        error: {
          code,
          message: b(errorCopy[code]),
          retryable: false,
          traceId: "local-demo",
          issues: [],
        },
      };
    }
  };
  const mutate = <T>(
    name: string,
    request: { clientRequestId: IdeationRequestId },
    callback: () => T,
  ): Promise<IdeationResult<T>> =>
    perform(() => {
      const key = `${name}:${request.clientRequestId}`,
        signature = JSON.stringify(request),
        old = requests.get(key);
      if (old) {
        if (old.signature !== signature)
          throw new DemoError("IDEMPOTENCY_CONFLICT");
        return old.result as T;
      }
      const result = callback();
      requests.set(key, { signature, result });
      return result;
    });
  function startTurn(
    sessionId: IdeationSessionId,
    content: string,
    revise?: IdeationPreview,
  ): IdeationMessageAccepted {
    validText(content);
    const row = open(sessionId);
    if (row.currentTurnId) throw new DemoError("TURN_IN_PROGRESS");
    const job = task(sessionId, "chuangyi-xietiaoyuan", "coordinator");
    updateSession(sessionId, {
      revision: row.revision + 1,
      currentTurnId: job.id,
    });
    const message = addMessage(sessionId, content, job.id);
    const response =
      "我会把固定事实和仍然开放的选择分开。请先阅读右侧的理解与干净委托，再决定是否交给下游。";
    later(timing.chunkMs, () => {
      if (tasks.get(job.id)?.status !== "QUEUED") return;
      changeTask(job.id, { status: "RUNNING" });
      const characters = Array.from(response);
      characters.forEach((text, index) => {
        later(index * timing.chunkMs, () => {
          if (tasks.get(job.id)?.status !== "RUNNING") return;
          emit(sessionId, job.id, {
            type: "delta",
            role: job.role,
            text: b(text),
          });
        });
      });
      later(characters.length * timing.chunkMs, () => {
        if (tasks.get(job.id)?.status !== "RUNNING") return;
        addMessage(sessionId, response, job.id, "assistant");
        const fixture = previewFixture(
          revise?.kind ?? "handoff",
          projectId,
          sessionId,
          job.id,
          (revise?.revision ?? 0) + 1,
        );
        const preview = addPreview({
          ...fixture,
          sessionRevision: row.revision + 1,
          supersedesPreviewId: revise?.id ?? null,
        });
        changeTask(job.id, {
          status: "AWAITING_PREVIEW_APPROVAL",
          outputPreviewIds: [preview.id],
        });
        updateSession(sessionId, { currentTurnId: null });
      });
    });
    return {
      sessionId,
      messageId: message.id,
      turnId: job.id,
      sessionRevision: row.revision + 1,
    };
  }
  function downstream(
    preview: IdeationPreview,
    kind: IdeationPreview["kind"],
    role: IdeationTask["role"],
    stage: IdeationTask["stage"],
  ) {
    const job = task(preview.sessionId, role, stage, preview.id);
    emit(job.sessionId, job.id, {
      type: "task_changed",
      taskId: job.id,
      status: job.status,
    });
    later(timing.chunkMs, () => {
      if (tasks.get(job.id)?.status === "QUEUED")
        changeTask(job.id, { status: "RUNNING" });
    });
    later(timing.responseMs, () => {
      if (tasks.get(job.id)?.status !== "RUNNING") return;
      const value = previewFixture(kind, projectId, preview.sessionId, job.id);
      const result =
        value.kind === "file_patch" && role === "waibu-zhishi-guwen"
          ? researchFixture(value)
          : value;
      addPreview(result);
      changeTask(job.id, {
        status: "AWAITING_PREVIEW_APPROVAL",
        outputPreviewIds: [result.id],
      });
    });
    return job.id;
  }
  function receipt(preview: IdeationPreview, activation = false) {
    let startedTaskId: IdeationRunId | null = null;
    if (preview.kind === "handoff")
      startedTaskId = downstream(
        preview,
        "file_patch",
        preview.handoff.recipient,
        "story",
      );
    if (preview.kind === "learning_plan") {
      if (preview.sourceMode === "external_search")
        throw new DemoError("SEARCH_UNAVAILABLE");
      startedTaskId = downstream(
        preview,
        "file_patch",
        "waibu-zhishi-guwen",
        "research",
      );
    }
    if (preview.kind === "expression_candidate") {
      if (preview.closureAudit.status !== "passed")
        throw new DemoError("CLOSURE_AUDIT_REQUIRED");
      if (activation && preview.trial.status !== "passed")
        throw new DemoError("NONCANONICAL_TRIAL_REQUIRED");
      if (!activation) {
        const activationTask = task(
          preview.sessionId,
          "biaoxian-shejishi",
          "expression",
          preview.id,
        );
        const next = previewFixture(
          "expression_candidate",
          projectId,
          preview.sessionId,
          activationTask.id,
          preview.revision + 1,
        );
        if (next.kind === "expression_candidate") {
          addPreview({
            ...next,
            approvalStage: "activation",
            supersedesPreviewId: preview.id,
            trial: {
              status: "passed",
              nonCanonical: true,
              report: {
                path: b("校验/隔离试写.md"),
                sha256: b("a".repeat(64)),
              },
              sample: b<IdeationSafeText>(
                "林砚把信翻到背面。纸上没有别的话。他用拇指压平折痕，才问驿卒：河边还有船吗？",
              ),
            },
          });
          changeTask(activationTask.id, {
            status: "AWAITING_PREVIEW_APPROVAL",
            outputPreviewIds: [next.id],
          });
        }
      }
    }
    const paths =
      preview.kind === "file_patch" || preview.kind === "expression_candidate"
        ? preview.patches.map((patch) => ({
            path: patch.kind === "create" ? patch.path : patch.resource.path,
            sha256: patch.afterSha256,
          }))
        : preview.kind === "generation_field"
          ? [preview.projection]
          : [];
    const value: IdeationApprovalReceipt = {
      id: uuid(),
      projectId: b(projectId),
      previewId: preview.id,
      approvedSha256: preview.sha256,
      coreApprovals: [],
      startedTaskId,
      committedFiles: paths,
      projectionRegistered: preview.kind === "generation_field",
      createdAt: now(),
    };
    decisions.set(value.id, value);
    addPreview({ ...preview, status: "approved" });
    changeTask(preview.taskId, { status: "SUCCEEDED", finishedAt: now() });
    emit(preview.sessionId, preview.taskId, {
      type: "approval_committed",
      decisionId: value.id,
      previewId: preview.id,
    });
    return value;
  }
  const page = <T>(items: readonly T[]) => ({ items, nextCursor: null });
  const api: IdeationClient = {
    createIdeationSession: (request) =>
      mutate("create", request, () => {
        const title = request.title ?? "新的构思";
        if (!title.trim() || Array.from(title).length > 80)
          throw new DemoError("INVALID_ARGUMENT");
        const value: IdeationSession = {
          projectId: b(projectId),
          capabilities: { externalSearch: false, modelMode: "faux" },
          id: uuid(),
          title,
          revision: 0,
          currentTurnId: null,
          status: "open",
          createdAt: now(),
          updatedAt: now(),
        };
        sessions = [...sessions, value];
        return value;
      }),
    getIdeationSession: (request) => perform(() => session(request.sessionId)),
    listIdeationMessages: (request) =>
      perform(() => {
        session(request.sessionId);
        return page(
          messages.filter((item) => item.sessionId === request.sessionId),
        );
      }),
    sendIdeationMessage: (request) =>
      mutate("send", request, () => {
        const row = open(request.sessionId);
        if (row.revision !== request.expectedSessionRevision)
          throw new DemoError("PRECONDITION_FAILED");
        return startTurn(request.sessionId, request.content);
      }),
    listPreviews: (request) =>
      perform(() => {
        session(request.sessionId);
        return page(
          [...previews.values()].filter(
            (item) =>
              item.sessionId === request.sessionId &&
              (!request.status || item.status === request.status),
          ),
        );
      }),
    getPreview: (request) =>
      perform(() => {
        const value = previews.get(request.previewId);
        if (!value) throw new DemoError("NOT_FOUND");
        return value;
      }),
    approvePreview: (request) =>
      mutate("approve", request, () => {
        if (request.confirmed !== true)
          throw new DemoError("APPROVAL_REQUIRED");
        const preview = checkedPreview(request);
        if (
          preview.kind === "expression_candidate" &&
          preview.approvalStage !== "candidate"
        )
          throw new DemoError("NONCANONICAL_TRIAL_REQUIRED");
        return receipt(preview);
      }),
    rejectPreview: (request) =>
      mutate("reject", request, () => {
        const preview = checkedPreview(request);
        if (request.reason) validText(request.reason);
        const message = request.reason
          ? addMessage(preview.sessionId, request.reason, preview.taskId)
          : null;
        addPreview({ ...preview, status: "rejected" });
        changeTask(preview.taskId, { status: "CANCELLED", finishedAt: now() });
        return {
          previewId: preview.id,
          status: "rejected" as const,
          coordinatorMessageId: message?.id ?? null,
        };
      }),
    revisePreview: (request) =>
      mutate("revise", request, () => {
        const preview = checkedPreview(request, true);
        validText(request.content);
        if (session(preview.sessionId).currentTurnId)
          throw new DemoError("TURN_IN_PROGRESS");
        const accepted = startTurn(preview.sessionId, request.content, preview);
        addPreview({ ...preview, status: "superseded" });
        return accepted;
      }),
    activateExpression: (request) =>
      mutate("activate", request, () => {
        const preview = checkedPreview(request);
        if (request.confirmed !== true || request.trialReadConfirmed !== true)
          throw new DemoError("APPROVAL_REQUIRED");
        if (
          preview.kind !== "expression_candidate" ||
          preview.approvalStage !== "activation" ||
          preview.resource.id !== request.resourceId
        )
          throw new DemoError("INVALID_ARGUMENT");
        if (preview.resource.sha256 !== request.expectedResourceSha256)
          throw new DemoError("RESOURCE_STALE");
        return receipt(preview, true);
      }),
    requestIdeationCompilation: (request) =>
      mutate("compile", request, () => {
        open(request.sessionId);
        if (!/^[1-9]\d{0,3}$/.test(request.chapter))
          throw new DemoError("INVALID_ARGUMENT");
        const job = task(
          request.sessionId,
          "zhangjie-qingjing-bianyiyuan",
          "compilation",
        );
        later(timing.chunkMs, () => {
          if (tasks.get(job.id)?.status === "QUEUED")
            changeTask(job.id, { status: "RUNNING" });
        });
        later(timing.responseMs, () => {
          if (tasks.get(job.id)?.status !== "RUNNING") return;
          const value = previewFixture(
            "generation_field",
            projectId,
            request.sessionId,
            job.id,
          );
          if (value.kind === "generation_field") {
            const result = addPreview({
              ...value,
              chapter: request.chapter,
              summary: b(`第${request.chapter}章：河岸来信`),
              projection: {
                ...value.projection,
                path: b(`故事/章节情境/第${request.chapter}章.md`),
              },
              scope: {
                ...value.scope,
                ...request.scope,
                chapter: request.chapter,
              },
            });
            changeTask(job.id, {
              status: "AWAITING_PREVIEW_APPROVAL",
              outputPreviewIds: [result.id],
            });
          }
        });
        return job;
      }),
    listIdeationTasks: (request) =>
      perform(() => {
        session(request.sessionId);
        return page(
          [...tasks.values()].filter(
            (item) => item.sessionId === request.sessionId,
          ),
        );
      }),
    getIdeationTask: (request) =>
      perform(() => {
        const value = tasks.get(request.taskId);
        if (!value) throw new DemoError("NOT_FOUND");
        return value;
      }),
    cancelIdeationTask: (request) =>
      mutate("cancel", request, () => {
        const value = tasks.get(request.taskId);
        if (!value) throw new DemoError("NOT_FOUND");
        open(value.sessionId);
        if (
          ["SUCCEEDED", "CANCELLED", "FAILED", "INTERRUPTED"].includes(
            value.status,
          )
        )
          throw new DemoError("ALREADY_DECIDED");
        changeTask(value.id, { status: "CANCELLED", finishedAt: now() });
        for (const preview of previews.values())
          if (preview.taskId === value.id && preview.status === "pending")
            addPreview({ ...preview, status: "stale" });
        if (session(value.sessionId).currentTurnId === value.id)
          updateSession(value.sessionId, { currentTurnId: null });
        const cancelled = tasks.get(value.id);
        if (!cancelled) throw new DemoError("NOT_FOUND");
        return cancelled;
      }),
    getIdeationApproval: (request) =>
      perform(() => {
        const value = decisions.get(request.decisionId);
        if (!value) throw new DemoError("NOT_FOUND");
        return value;
      }),
    listIdeationEvents: (request) =>
      perform(() => {
        session(request.sessionId);
        return page(
          events.filter(
            (event) =>
              event.sessionId === request.sessionId &&
              BigInt(event.id) > BigInt(request.after ?? "0"),
          ),
        );
      }),
  };
  // Local session list/close affordances await the exact v1.1 signatures. No speculative HTTP mapping.
  const closeSession = (id: IdeationSessionId) =>
    perform(() => {
      const value = open(id);
      if (value.currentTurnId) throw new DemoError("TURN_IN_PROGRESS");
      updateSession(id, { status: "closed" });
      return session(id);
    });
  function attempt(sessionId: IdeationSessionId, refusal: boolean) {
    if (session(sessionId).status === "closed") return;
    const runId = uuid<IdeationRunId>();
    runs.push({ sessionId, runId });
    const role = "chuangyi-xietiaoyuan" as const;
    emit(sessionId, runId, {
      type: "delta",
      role,
      text: b("尚未完成的旧尝试。"),
    });
    later(timing.resetMs, () =>
      emit(sessionId, runId, {
        type: "reset",
        role,
        reason: refusal ? "security_refusal" : "format_correction",
      }),
    );
    later(timing.responseMs, () =>
      emit(sessionId, runId, {
        type: "delta",
        role,
        text: b(
          refusal
            ? "这部分属于平台内部设置，我没法提供。我们继续聊你的故事吧。"
            : "更正后的思路：让渡河的决定留在人物手中。",
        ),
      }),
    );
    return runId;
  }
  return {
    initialSessionId: session(b("00000000-0000-4000-8000-000000000001")).id,
    api,
    get sessions() {
      return sessions;
    },
    runs,
    attempt,
    closeSession,
    subscribe(listener: (event: IdeationEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
    },
  };
}

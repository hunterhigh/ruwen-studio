import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { candidateProblems, ledgers } from "@ruwen/core";
import { loadRun } from "@ruwen/pipeline";
import { afterEach, expect, inject, it } from "vitest";
import type { Task, WorkerService } from "../src/service.ts";
import { fixture, waitStatus } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
function child(
  service: WorkerService,
  task?: Task,
  fault?: { kind: string; name: string },
  editorProblem = false,
) {
  const proc = spawn(
    process.execPath,
    [fileURLToPath(new URL("./child.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        REAL_MODEL: "0",
        MODEL_MODE: "faux",
        RUWEN_CHILD_DB: inject("databaseUrl"),
        RUWEN_CHILD_QUEUE: service.queue,
        RUWEN_FAUX_EDITOR_PROBLEM: editorProblem ? "1" : "0",
        ...(task ? { RUWEN_CHILD_TASK: JSON.stringify(task) } : {}),
        ...(fault
          ? { RUWEN_FAULT_KIND: fault.kind, RUWEN_FAULT_NAME: fault.name }
          : {}),
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  const messages: { type: string; status?: string; message?: string }[] = [];
  let stderr = "";
  proc.stderr?.on("data", (data) => {
    stderr += data.toString();
  });
  proc.on("message", (message) => {
    messages.push(message as (typeof messages)[number]);
  });
  let exited = false;
  const closed = new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("exit", () => {
      exited = true;
      resolve();
    });
  }).then(async () => {
    if (!task) return;
    // OS exit precedes PostgreSQL noticing the dead connection. Recovery must wait
    // for that session's advisory lock, rather than accidentally testing job deferral.
    const deadline = Date.now() + 5000;
    while (true) {
      const client = await service.db.pool.connect();
      try {
        const key = `ruwen:project:${task.projectId}`;
        const acquired = (
          await client.query<{ locked: boolean }>(
            "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked",
            [key],
          )
        ).rows[0]?.locked;
        if (acquired) {
          await client.query(
            "SELECT pg_advisory_unlock(hashtextextended($1,0))",
            [key],
          );
          return;
        }
      } finally {
        client.release();
      }
      if (Date.now() > deadline)
        throw new Error("Killed worker database lock was not released");
      await delay(20);
    }
  });
  cleanup.push(async () => {
    if (!exited) proc.kill("SIGKILL");
    await closed;
  });
  return {
    proc,
    closed,
    async wait(type: string, timeout = 20000) {
      const start = performance.now();
      while (performance.now() - start < timeout) {
        const result = messages.find((m) => m.type === type);
        if (result) return result;
        const failure = messages.find((m) => m.type === "failed");
        if (failure) throw new Error(failure.message);
        if (exited) throw new Error(`Worker exited: ${stderr}`);
        await delay(20);
      }
      throw new Error(`Timed out waiting for child ${type}: ${stderr}`);
    },
  };
}
async function setup(target: string) {
  const p = await fixture();
  cleanup.push(() => p.service.stop());
  const id = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  let task: Task = {
    kind: "chapter",
    projectId: p.fs.projectId,
    ownerId: p.fs.ownerId,
    runId: id,
  };
  const memoryStage = [
    "CANDIDATE_APPROVED",
    "MEMORY_PREVIEW_READY",
    "AWAITING_MEMORY_APPROVAL",
    "MEMORY_COMMITTED",
    "DONE",
    "jiyi-weihuyuan",
  ];
  if (memoryStage.includes(target)) {
    await p.service.handle(task);
    const run = await loadRun(p.fs, id);
    task = {
      ...task,
      kind: "candidate",
      decision: {
        confirmed: true,
        expectedSha256: String(run.candidateSha256),
      },
    };
    if (target !== "CANDIDATE_APPROVED") {
      await p.service.handle(task);
      task = {
        kind: "memory_preview",
        projectId: p.fs.projectId,
        ownerId: p.fs.ownerId,
        runId: id,
      };
      if (["MEMORY_COMMITTED", "DONE"].includes(target)) {
        await p.service.handle(task);
        const run = await loadRun(p.fs, id);
        task = {
          ...task,
          kind: "memory",
          decision: {
            confirmed: true,
            expectedSha256: String(run.memoryPreviewSha256),
          },
        };
      }
    }
  }
  return { ...p, id, task };
}
it("SIGKILL after successful editor persistence preserves exactly one pending problem across recovery and abandonment", async () => {
  const p = await fixture();
  cleanup.push(() => p.service.stop());
  const id = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  const task: Task = {
    kind: "chapter",
    projectId: p.fs.projectId,
    ownerId: p.fs.ownerId,
    runId: id,
  };
  const process = child(
    p.service,
    task,
    { kind: "role_completed", name: "wenxue-bianji" },
    true,
  );
  await process.wait("fault");
  expect(await ledgers.readEntries(p.fs, candidateProblems.PATH)).toHaveLength(
    1,
  );
  process.proc.kill("SIGKILL");
  await process.closed;
  await p.service.handle(task);
  expect((await loadRun(p.fs, id)).status).toBe("AWAITING_CANDIDATE_APPROVAL");
  expect(await ledgers.readEntries(p.fs, candidateProblems.PATH)).toHaveLength(
    1,
  );
  await p.service.cancel(p.fs, id);
  await p.service.handle({ ...task, kind: "cancel" });
  const entries = await ledgers.readEntries(p.fs, candidateProblems.PATH);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    status: "abandoned",
    task_id: candidateProblems.taskId(p.fs.projectId, "001"),
  });
}, 30000);
it.each([
  "REQUESTED",
  "READINESS_OK",
  "PACKET_COMPILED",
  "AUTHOR_DONE",
  "READER_DONE",
  "EDITOR_DONE",
  "PLOT_CHECKED",
  "REALITY_CHECKED",
  "AWAITING_CANDIDATE_APPROVAL",
  "CANDIDATE_APPROVED",
  "MEMORY_PREVIEW_READY",
  "AWAITING_MEMORY_APPROVAL",
  "MEMORY_COMMITTED",
  "DONE",
])("SIGKILL inside %s transaction resumes from committed state without duplicate role costs or approval consumption", async (stage) => {
  const p = await setup(stage);
  const before = await p.fs.sha256("世界/当前态势.md");
  const first = child(p.service, p.task, { kind: "checkpoint", name: stage });
  await first.wait("fault");
  first.proc.kill("SIGKILL");
  await first.closed;
  const second = child(p.service, p.task);
  const result = await second.wait("completed");
  const expected =
    p.task.kind === "chapter"
      ? "AWAITING_CANDIDATE_APPROVAL"
      : p.task.kind === "candidate"
        ? "CANDIDATE_APPROVED"
        : p.task.kind === "memory_preview"
          ? "AWAITING_MEMORY_APPROVAL"
          : "DONE";
  expect(result.status).toBe(expected);
  const counts = await p.service.db.pool.query<{ role_id: string; n: string }>(
    "SELECT r.role_id,count(c.role_run_id) n FROM role_runs r LEFT JOIN role_cost_events c ON c.role_run_id=r.id WHERE r.run_id=$1 GROUP BY r.role_id",
    [p.id],
  );
  expect(counts.rows.every((row) => row.n === "1")).toBe(true);
  const settled = await p.service.db.pool.query<{
    n: string;
    charged: string;
    expected: string;
  }>(
    "SELECT count(l.id) n,min(l.delta_credits)::text charged,ceil(c.cost_usd*rs.cost_markup*rs.credits_per_usd)::bigint::text expected FROM role_runs r JOIN role_cost_events c ON c.role_run_id=r.id JOIN credit_reservations rs ON rs.run_id=r.run_id LEFT JOIN credit_ledger l ON l.ref_type='role' AND l.ref_id=r.id::text AND l.reason='role_usage' WHERE r.run_id=$1 GROUP BY r.id,c.cost_usd,rs.cost_markup,rs.credits_per_usd",
    [p.id],
  );
  expect(settled.rows).toHaveLength(counts.rows.length);
  for (const row of settled.rows) {
    expect(row.n).toBe("1");
    expect(BigInt(row.charged)).toBe(-BigInt(row.expected));
  }
  expect(counts.rowCount).toBe(
    p.task.kind === "chapter" || p.task.kind === "candidate" ? 5 : 6,
  );
  const run = await loadRun(p.fs, p.id);
  expect(await p.fs.exists(run.target)).toBe(p.task.kind !== "chapter");
  const usage = await p.fs.list("治理/审批/已使用");
  expect(
    usage.filter((path) => path.endsWith(`/candidate-${p.id}.json`)),
  ).toHaveLength(p.task.kind === "chapter" ? 0 : 1);
  expect(
    usage.filter((path) => path.endsWith(`/memory-${p.id}.json`)),
  ).toHaveLength(p.task.kind === "memory" ? 1 : 0);
  expect((await p.fs.sha256("世界/当前态势.md")) === before).toBe(
    p.task.kind !== "memory",
  );
}, 40000);
it.each([
  "xiaoshuo-zuozhe",
  "qinggan-duzhe",
  "wenxue-bianji",
  "qingjie-heyanyuan",
  "xianshi-heyanyuan",
  "jiyi-weihuyuan",
])("SIGKILL after %s result commit reuses the result on redelivery", async (role) => {
  const p = await setup(role);
  const first = child(p.service, p.task, {
    kind: "role_completed",
    name: role,
  });
  await first.wait("fault");
  first.proc.kill("SIGKILL");
  await first.closed;
  const second = child(p.service, p.task);
  expect((await second.wait("completed")).status).toBe(
    role === "jiyi-weihuyuan"
      ? "AWAITING_MEMORY_APPROVAL"
      : "AWAITING_CANDIDATE_APPROVAL",
  );
  const result = await p.service.db.pool.query(
    "SELECT 1 FROM role_runs r JOIN role_cost_events c ON c.role_run_id=r.id WHERE r.run_id=$1 AND role_id=$2",
    [p.id, role],
  );
  expect(result.rowCount).toBe(1);
}, 40000);
it.each([
  "xiaoshuo-zuozhe",
  "jiyi-weihuyuan",
])("SIGKILL after %s response but before persistence blocks an automatic second model request", async (role) => {
  const p = await setup(role);
  const first = child(p.service, p.task, { kind: "role_response", name: role });
  await first.wait("fault");
  first.proc.kill("SIGKILL");
  await first.closed;
  const second = child(p.service, p.task);
  expect((await second.wait("completed")).status).toBe("FAILED");
  const run = await loadRun(p.fs, p.id);
  expect(run.error).toContain("unknown provider outcome");
  const cost = await p.service.db.pool.query<{
    status: string;
    cost_usd: string | null;
  }>("SELECT status,cost_usd FROM role_runs WHERE run_id=$1 AND role_id=$2", [
    p.id,
    role,
  ]);
  expect(cost.rows[0]).toEqual({ status: "running", cost_usd: null });
  const held = (
    await p.service.db.pool.query<{ status: string; remaining: string }>(
      "SELECT status,remaining::text FROM credit_reservations WHERE run_id=$1",
      [p.id],
    )
  ).rows[0];
  expect(held?.status).toBe("review");
  expect(BigInt(held?.remaining ?? "0")).toBeGreaterThan(0n);
}, 40000);
it("actual pg-boss heartbeat expiry redelivers a killed worker job to a new worker", async () => {
  const p = await setup("AUTHOR_DONE");
  const first = child(p.service, undefined, {
    kind: "checkpoint",
    name: "AUTHOR_DONE",
  });
  await first.wait("fault");
  first.proc.kill("SIGKILL");
  await first.closed;
  const second = child(p.service);
  await second.wait("ready");
  await waitStatus(p.service, p.id, "AWAITING_CANDIDATE_APPROVAL", 30000);
  const rows = await p.service.db.pool.query(
    "SELECT 1 FROM role_cost_events c JOIN role_runs r ON r.id=c.role_run_id WHERE r.run_id=$1",
    [p.id],
  );
  expect(rows.rowCount).toBe(5);
}, 45000);

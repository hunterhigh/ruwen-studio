import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFauxRuntime, FAUX_PROSE } from "@ruwen/agents";
import {
  approval,
  checks,
  exportProjectZip,
  importProjectZip,
  LocalDirFS,
  ledgers,
} from "@ruwen/core";
import { CHAPTER_ROLES, loadRun, runPath } from "@ruwen/pipeline";
import { afterEach, expect, it } from "vitest";
import {
  defaultFauxResponse,
  requestRole,
} from "../../../packages/agents/src/faux.ts";
import type { Task, WorkerOptions } from "../src/service.ts";
import { fixture } from "./helpers.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function chapter(options: Partial<WorkerOptions> = {}) {
  const { fs, service } = await fixture(options);
  cleanups.push(() => service.stop());
  const id = await service.enqueueChapter(fs, {
    chapter: 1,
    lockedEvents: ["粮车离开驿站"],
  });
  const task = (kind: Task["kind"], runId: string = id) =>
    service.handle({
      kind,
      runId,
      projectId: fs.projectId,
      ownerId: fs.ownerId,
    });
  await task("chapter");
  const run = await loadRun(fs, id);
  expect(run.status, run.error).toBe("AWAITING_CANDIDATE_APPROVAL");
  if (!run.candidateSha256 || !run.paths.candidate || !run.paths.original)
    throw new Error("Missing candidate fixture");
  const approve = (expectedSha256: string) =>
    service.handle({
      kind: "candidate",
      runId: id,
      projectId: fs.projectId,
      ownerId: fs.ownerId,
      decision: { expectedSha256, confirmed: true },
    });
  return {
    fs,
    service,
    id,
    run,
    task,
    approve,
    oldHash: run.candidateSha256,
    candidatePath: run.paths.candidate,
    originalPath: run.paths.original,
  };
}

it("snapshots legacy originals, serializes saves, records dual audits and round-trips version files", async () => {
  const { fs, service, id, run, oldHash, candidatePath, originalPath } =
    await chapter();
  const original = await fs.readText(originalPath);
  const before = await service.db.pool.query(
    "SELECT id FROM credit_ledger WHERE user_id=$1 ORDER BY id",
    [fs.ownerId],
  );
  delete run.candidateVersions;
  delete run.candidateVersion;
  delete run.verificationBasisSha256;
  await fs.write(runPath(id), JSON.stringify(run));
  await expect(
    service.reviseCandidate(fs, id, oldHash, " \r\n "),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.reviseCandidate(fs, id, oldHash, "字".repeat(100001)),
  ).rejects.toMatchObject({ status: 413 });
  const texts = [
    "第一段仍有两个空格。  \r\n\r\n第二段。𠀀\r",
    "另一处手写修改。\n",
  ];
  const attempts = await Promise.allSettled(
    texts.map((text) => service.reviseCandidate(fs, id, oldHash, text)),
  );
  expect(attempts.filter((entry) => entry.status === "fulfilled")).toHaveLength(
    1,
  );
  const rejected = attempts.find((entry) => entry.status === "rejected");
  expect(rejected).toMatchObject({ reason: { status: 409 } });
  const selected = attempts.findIndex((entry) => entry.status === "fulfilled");
  const expectedText = texts[selected]?.replace(/\r\n?/g, "\n");
  const updated = await loadRun(fs, id);
  const current = updated.candidateVersions?.at(-1);
  if (!current) throw new Error("Missing saved version");
  expect(updated.candidateVersions?.map(({ source }) => source)).toEqual([
    "author",
    "editor",
    "user",
  ]);
  expect(current).toMatchObject({
    version: 3,
    source: "user",
    op: "manual",
    createdAt: expect.any(String),
  });
  expect(await service.candidateRevision(fs, id, current.version)).toBe(
    expectedText,
  );
  expect(await fs.readText(originalPath)).toBe(original);
  expect(await fs.sha256(candidatePath)).toBe(oldHash);
  expect(updated.verificationBasisSha256).toBe(oldHash);
  expect(await fs.exists(updated.target)).toBe(false);
  expect(
    (
      await service.db.pool.query(
        "SELECT id FROM credit_ledger WHERE user_id=$1 ORDER BY id",
        [fs.ownerId],
      )
    ).rows,
  ).toEqual(before.rows);
  expect(
    (
      await service.db.pool.query(
        "SELECT * FROM candidate_revision_audit WHERE run_id=$1",
        [id],
      )
    ).rows,
  ).toEqual([
    expect.objectContaining({
      run_id: id,
      actor_id: fs.ownerId,
      project_id: fs.projectId,
      version: 3,
      event: "candidate_user_revision",
      before_sha256: oldHash,
      after_sha256: current.sha256,
      changed_chars: expect.any(Number),
      op: "manual",
    }),
  ]);
  await expect(
    service.db.pool.query(
      "UPDATE candidate_revision_audit SET changed_chars=0 WHERE run_id=$1",
      [id],
    ),
  ).rejects.toThrow("append-only");
  const events = await ledgers.readEntries(fs, "治理/审计账本.jsonl");
  const revisionEvents = events.filter(
    ({ change }) => change === "candidate_user_revision",
  );
  expect(revisionEvents).toHaveLength(1);
  const { time, ...summary } = revisionEvents[0] ?? {};
  expect(time).toBeTruthy();
  expect(ledgers.validateAudit(summary)).toEqual([]);
  expect(summary).not.toHaveProperty("before_sha256");

  const temporary = await mkdtemp(
    path.join(tmpdir(), "ruwen-revision-export-"),
  );
  if (
    path.dirname(temporary) !== path.resolve(tmpdir()) ||
    !path.basename(temporary).startsWith("ruwen-revision-export-")
  )
    throw new Error("Unsafe candidate fixture path");
  cleanups.push(() => rm(temporary, { recursive: true, force: true }));
  const imported = new LocalDirFS(path.join(temporary, "project"));
  await importProjectZip(imported, await exportProjectZip(fs));
  const entries = await fs.list();
  expect(await imported.list()).toEqual(entries);
  for (const entry of entries)
    expect(await imported.sha256(entry)).toBe(await fs.sha256(entry));
  expect((await checks.governanceCheck(imported)).valid).toBe(true);
  const python = spawnSync(
    process.env.PYTHON_BIN ?? "python",
    [
      "-I",
      "-B",
      path.resolve("packages/core/test/differential/python-oracle.py"),
      path.resolve("vendor/ruwen/01-完整插件/ruwen-xiezuo-xitong/scripts"),
      "governance_check",
      "--project-root",
      imported.root,
    ],
    { cwd: imported.root, encoding: "utf8", windowsHide: true },
  );
  expect(python.status, python.stderr || python.stdout).toBe(0);
}, 30000);

it("bills only the two explicit verifier calls, binds approval to the latest text and gives approved prose to memory", async () => {
  const old = "ONLY_IN_FIRST_DRAFT_73E4";
  const added = "ONLY_IN_USER_REVISION_201E";
  const captured: string[] = [];
  const p = await chapter({
    runtime: () =>
      createFauxRuntime(
        Array.from({ length: 15 }, () => (context) => {
          const role = requestRole(context);
          const response = defaultFauxResponse(context);
          if (role === CHAPTER_ROLES.author)
            return {
              ...response,
              content: [{ type: "text", text: `${FAUX_PROSE}\n\n${old}` }],
            };
          if (role === CHAPTER_ROLES.memory)
            captured.push(JSON.stringify(context));
          return response;
        }),
      ),
  });
  const nextText = `${FAUX_PROSE}\n\n${added}`;
  const revision = await p.service.reviseCandidate(
    p.fs,
    p.id,
    p.oldHash,
    nextText,
  );
  await expect(
    p.service.enqueueReverification(p.fs, p.id, p.oldHash),
  ).rejects.toMatchObject({ status: 409 });
  const verification = await p.service.enqueueReverification(
    p.fs,
    p.id,
    revision.sha256,
  );
  await expect(
    p.service.enqueueReverification(p.fs, p.id, revision.sha256),
  ).rejects.toMatchObject({ status: 409 });
  await expect(p.approve(revision.sha256)).rejects.toThrow("pending");
  await p.task("reverify", verification);
  await p.task("reverify", verification);
  const run = await loadRun(p.fs, p.id);
  expect(run).toMatchObject({
    status: "AWAITING_CANDIDATE_APPROVAL",
    verificationBasisSha256: revision.sha256,
    reverification: { id: verification, status: "passed" },
  });
  const { rows } = await p.service.db.pool.query(
    "SELECT rr.role_id,rr.input_manifest,cl.delta_credits::int charged FROM role_runs rr JOIN credit_ledger cl ON cl.ref_type='role' AND cl.ref_id=rr.id::text AND cl.reason='role_usage' WHERE rr.run_id=$1 ORDER BY rr.role_id",
    [verification],
  );
  expect(rows.map(({ role_id }) => role_id)).toEqual(
    [CHAPTER_ROLES.plot, CHAPTER_ROLES.reality].sort(),
  );
  expect(
    rows.every(
      ({ charged, input_manifest }) =>
        charged <= 0 && input_manifest?.version === 1,
    ),
  ).toBe(true);
  expect(
    (
      await p.service.db.pool.query(
        "SELECT status,remaining::int FROM credit_reservations WHERE run_id=$1",
        [verification],
      )
    ).rows[0],
  ).toEqual({ status: "released", remaining: 0 });
  await expect(p.approve(p.oldHash)).rejects.toThrow("hash does not match");
  await p.approve(revision.sha256);
  await p.approve(revision.sha256);
  expect(await p.fs.sha256(run.target)).toBe(revision.sha256);
  expect(
    (await approval.usageEntries(p.fs)).filter(
      ({ event_id }) => event_id === `candidate-${p.id}`,
    ),
  ).toHaveLength(1);
  await p.task("memory_preview");
  expect(captured.join("\n")).toContain(added);
  expect(captured.join("\n")).not.toContain(old);
  await expect(
    p.service.reviseCandidate(p.fs, p.id, revision.sha256, "已经批准。"),
  ).rejects.toMatchObject({ status: 409 });
}, 30000);

it("definite verifier failure returns to compilation even if the child is cancelled after the verdict", async () => {
  let fail = false;
  let cancelAfterVerdict: (() => Promise<void>) | undefined;
  const p = await chapter({
    onBoundary: async (kind, name) => {
      if (kind === "role_completed" && name === CHAPTER_ROLES.plot)
        await cancelAfterVerdict?.();
    },
    runtime: () =>
      createFauxRuntime(
        Array.from({ length: 15 }, () => (context) => {
          const response = defaultFauxResponse(context);
          if (fail && requestRole(context) === CHAPTER_ROLES.plot) {
            const tool = response.content.find(
              (entry) => entry.type === "toolCall",
            );
            if (tool)
              tool.arguments = {
                pass: false,
                issues: [
                  {
                    promise: "粮车离开驿站",
                    problem: "missing",
                    evidence: "这一版本停在门前。",
                  },
                ],
              };
          }
          return response;
        }),
      ),
  });
  const revision = await p.service.reviseCandidate(
    p.fs,
    p.id,
    p.oldHash,
    "马匹仍在门内。\n",
  );
  fail = true;
  const verification = await p.service.enqueueReverification(
    p.fs,
    p.id,
    revision.sha256,
  );
  cancelAfterVerdict = () => p.service.cancel(p.fs, verification);
  await p.task("reverify", verification);
  expect(await loadRun(p.fs, p.id)).toMatchObject({
    status: "RETURNED",
    returnedTo: "zhangjie-qingjing-bianyiyuan",
    verificationBasisSha256: revision.sha256,
    reverification: { status: "returned" },
  });
  await expect(p.approve(revision.sha256)).rejects.toThrow(
    "cannot be approved",
  );
  expect(await p.fs.exists(p.run.target)).toBe(false);
}, 30000);

it("a new save during verification leaves the new version's verdict stale", async () => {
  let resume = () => {};
  let identify = "";
  let reached = () => {};
  const ready = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const waiting = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const p = await chapter({
    onBoundary: async (kind, name, id) => {
      if (
        kind === "role_completed" &&
        name === CHAPTER_ROLES.plot &&
        identify === id
      ) {
        reached();
        await waiting;
      }
    },
  });
  identify = await p.service.enqueueReverification(p.fs, p.id, p.oldHash);
  const work = p.task("reverify", identify);
  try {
    await ready;
    const revision = await p.service.reviseCandidate(
      p.fs,
      p.id,
      p.oldHash,
      "这次他先合上了门。",
    );
    resume();
    await work;
    expect(await loadRun(p.fs, p.id)).toMatchObject({
      candidateSha256: revision.sha256,
      verificationBasisSha256: p.oldHash,
      status: "AWAITING_CANDIDATE_APPROVAL",
      reverification: { status: "stale" },
    });
    expect(
      (
        await p.service.db.pool.query(
          "SELECT role_id FROM role_runs WHERE run_id=$1",
          [identify],
        )
      ).rows,
    ).toEqual([{ role_id: CHAPTER_ROLES.plot }]);
  } finally {
    resume();
    await work;
  }
}, 30000);

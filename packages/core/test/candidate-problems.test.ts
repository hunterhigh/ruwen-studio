import { afterEach, expect, it } from "vitest";
import { candidateProblems, ledgers } from "../src/index.ts";
import { temporaryProject } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
const problem = {
  location: "正文定位",
  category: "explanation",
  condition: "条件",
  handling: "处理",
  result: "结果",
};
async function project() {
  const p = await temporaryProject();
  cleanup.push(p.cleanup);
  return p;
}
it("three observations across two chapters form a candidate including abandoned drafts; statuses never delete or recount", async () => {
  const { fs } = await project();
  for (const [i, chapter] of ["001", "1", "002"].entries())
    await candidateProblems.record(
      fs,
      { projectId: "project-A", chapter, runId: `run-${i}`, status: "pending" },
      [problem],
    );
  await candidateProblems.setStatus(fs, "run-0", "abandoned", "project-A");
  await candidateProblems.setStatus(fs, "run-1", "returned", "project-A");
  await candidateProblems.setStatus(fs, "run-2", "approved", "project-A");
  const entries = await ledgers.readEntries(fs, candidateProblems.PATH);
  expect(entries.map((entry) => entry.status)).toEqual([
    "abandoned",
    "returned",
    "approved",
  ]);
  expect(entries[2]?.recurrence_candidate).toBe(true);
  expect((await candidateProblems.counts(fs, "project-A")).categories).toEqual([
    {
      category: "explanation",
      count: 3,
      task_count: 2,
      recurrence_candidate: true,
    },
  ]);
  await candidateProblems.record(
    fs,
    { projectId: "project-A", chapter: "2", runId: "run-2", status: "pending" },
    [problem],
  );
  await candidateProblems.setStatus(fs, "run-2", "abandoned", "project-A");
  expect(await ledgers.readEntries(fs, candidateProblems.PATH)).toEqual(
    entries,
  );
});
it("normalizes chapter number aliases and refuses a changed replay", async () => {
  const { fs } = await project();
  for (const [i, chapter] of ["1", "001", "0001"].entries())
    await candidateProblems.record(
      fs,
      { projectId: "project-A", chapter, runId: `run-${i}`, status: "pending" },
      [problem],
    );
  expect((await candidateProblems.counts(fs, "project-A")).categories).toEqual([
    {
      category: "explanation",
      count: 3,
      task_count: 1,
      recurrence_candidate: false,
    },
  ]);
  await expect(
    candidateProblems.record(
      fs,
      {
        projectId: "project-A",
        chapter: "1",
        runId: "run-0",
        status: "pending",
      },
      [{ ...problem, handling: "篡改" }],
    ),
  ).rejects.toThrow("已变化");
});
it("upgrades old B1 run-ID tasks from saved provenance without changing the upstream-compatible CLI ledger API", async () => {
  const { fs } = await project();
  for (const [i, chapter] of ["001", "001", "002"].entries()) {
    const id = `00000000-0000-4000-8000-00000000000${i}`;
    await fs.write(
      `${candidateProblems.RUN_DIRECTORY}/${id}/run.json`,
      JSON.stringify({ id, chapter, status: i === 0 ? "CANCELLED" : "DONE" }),
    );
    await ledgers.appendProblem(fs, {
      ...problem,
      task_id: id,
      status: "candidate_approved",
    });
  }
  expect((await candidateProblems.counts(fs, "project-A")).categories).toEqual([
    {
      category: "explanation",
      count: 3,
      task_count: 2,
      recurrence_candidate: true,
    },
  ]);
  await candidateProblems.setStatus(
    fs,
    "00000000-0000-4000-8000-000000000000",
    "abandoned",
    "project-A",
  );
  const entries = await ledgers.readEntries(fs, candidateProblems.PATH);
  expect(entries[0]?.status).toBe("abandoned");
  expect(entries[0]?.task_id).toBe(entries[1]?.task_id);
  expect(entries[0]?.run_id).not.toBe(entries[1]?.run_id);
});

import { assemblePrompt, ROLES } from "@ruwen/agents";
import { exportProjectZip, importProjectZip, LocalDirFS } from "@ruwen/core";
import { afterEach, expect, it } from "vitest";
import { temporaryProject } from "../../../packages/core/test/helpers.ts";
import { fixture } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
it("faux worker saves prompts only to the platform table; project/ZIP/service responses contain no private prompt fragments or system transcript", async () => {
  const { service, fs } = await fixture();
  cleanup.push(() => service.stop());
  const id = await service.enqueueChapter(fs, { chapter: 1 });
  const run = await service.handle({
    kind: "chapter",
    projectId: fs.projectId,
    ownerId: fs.ownerId,
    runId: id,
  });
  expect(run?.status).toBe("AWAITING_CANDIDATE_APPROVAL");
  const roleRows = await service.db.pool.query(
    "SELECT r.result,r.transcript,p.content FROM role_runs r JOIN prompts p ON p.sha256=r.prompt_sha256 WHERE run_id=$1",
    [id],
  );
  expect(roleRows.rowCount).toBe(5);
  for (const row of roleRows.rows) {
    expect(row.content.length).toBeGreaterThan(100);
    expect(row.result).not.toHaveProperty("systemPrompt");
    expect(
      row.transcript.some((m: { role: string }) => m.role === "system"),
    ).toBe(false);
  }
  const restored = await temporaryProject();
  cleanup.push(restored.cleanup);
  const imported = new LocalDirFS(`${restored.fs.root}-import`);
  await importProjectZip(imported, await exportProjectZip(fs));
  const forbidden =
    "平台未提供的操作不可自行执行，批准不可由本岗位代替用户作出。";
  expect(Array.from(forbidden).length).toBeGreaterThanOrEqual(30);
  expect((await assemblePrompt(ROLES["xiaoshuo-zuozhe"])).content).toContain(
    forbidden,
  );
  const surfaces = [
    JSON.stringify(run),
    JSON.stringify(
      roleRows.rows.map((r) => ({
        result: r.result,
        transcript: r.transcript,
      })),
    ),
  ];
  for (const p of await imported.list()) {
    expect(p).not.toContain("/reports/prompts/");
    surfaces.push(await imported.readText(p));
  }
  for (const body of surfaces) {
    expect(body).not.toContain(forbidden);
    expect(body).not.toContain(process.env.RUWEN_CANARY);
    expect(body).not.toContain('"systemPrompt"');
  }
});

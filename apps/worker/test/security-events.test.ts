import { createFauxRuntime } from "@ruwen/agents";
import { PostgresFS } from "@ruwen/db";
import { afterEach, expect, it } from "vitest";
import { defaultFauxResponse } from "../../../packages/agents/src/faux.ts";
import { deploymentCanary } from "../../../packages/agents/src/security/notes.ts";
import { getSecurityRiskScore } from "../src/security-events.ts";
import { fixture } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
it("blocked output persists one metadata-only risk event with usage and remains idempotent on recovery", async () => {
  const { fs, service } = await fixture({
    runtime: () =>
      createFauxRuntime([
        (context) => ({
          ...defaultFauxResponse(context),
          content: [{ type: "text", text: deploymentCanary() }],
          stopReason: "stop",
        }),
      ]),
  });
  cleanup.push(() => service.stop());
  const id = await service.enqueueChapter(fs, { chapter: 1 });
  const task = {
    kind: "chapter" as const,
    projectId: fs.projectId,
    ownerId: fs.ownerId,
    runId: id,
  };
  expect((await service.handle(task))?.status).toBe("FAILED");
  await service.handle(task);
  const events = await service.db.pool.query(
    "SELECT * FROM security_events WHERE run_id=$1",
    [id],
  );
  expect(events.rowCount).toBe(1);
  expect(events.rows[0].kind).toBe("canary");
  expect(JSON.stringify(events.rows)).not.toContain(deploymentCanary());
  expect(await getSecurityRiskScore(fs)).toBe(1);
  const rows = await service.db.pool.query(
    "SELECT r.result,r.usage FROM role_runs r WHERE run_id=$1",
    [id],
  );
  expect(rows.rows[0].usage).toHaveLength(1);
  expect(JSON.stringify(rows.rows)).not.toContain(deploymentCanary());
  for (const p of await fs.list())
    expect(await fs.readText(p)).not.toContain(deploymentCanary());
  const other = new PostgresFS(
    service.db,
    fs.projectId,
    "00000000-0000-4000-8000-000000000000",
  );
  await expect(getSecurityRiskScore(other)).rejects.toThrow();
});
it("a failed pipeline checkpoint recovers the saved blocked role without recounting risk or incurred usage", async () => {
  let fail = true;
  const { fs, service } = await fixture({
    runtime: () =>
      createFauxRuntime([
        (context) => ({
          ...defaultFauxResponse(context),
          content: [{ type: "text", text: deploymentCanary() }],
          stopReason: "stop",
        }),
      ]),
    onBoundary: async (kind, name) => {
      if (fail && kind === "checkpoint" && name === "FAILED") {
        fail = false;
        throw new Error("checkpoint fault");
      }
    },
  });
  cleanup.push(() => service.stop());
  const id = await service.enqueueChapter(fs, { chapter: 1 });
  const task = {
    kind: "chapter" as const,
    projectId: fs.projectId,
    ownerId: fs.ownerId,
    runId: id,
  };
  await expect(service.handle(task)).rejects.toThrow("checkpoint fault");
  expect((await service.handle(task))?.status).toBe("FAILED");
  expect(await getSecurityRiskScore(fs)).toBe(1);
  expect(
    (
      await service.db.pool.query(
        "SELECT id FROM security_events WHERE run_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await service.db.pool.query(
        "SELECT role_run_id FROM role_cost_events e JOIN role_runs r ON r.id=e.role_run_id WHERE r.run_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(1);
});

import { randomUUID } from "node:crypto";
import { type Data, fauxOutput, type RoleId } from "@ruwen/agents";
import { approval, state } from "@ruwen/core";
import { afterEach, expect, it } from "vitest";
import { fixture, waitStatus } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});
it.each([
  "xiangmu-zhiliyuan",
  "waibu-zhishi-guwen",
  "biaoxian-shejishi",
  "gushi-gousishi",
] as RoleId[])("approved handoff to %s produces only a pending preview and consumes approval once", async (recipient) => {
  const p = await fixture({}, true);
  cleanup.push(() => p.service.stop());
  const world = await p.fs.sha256("世界/当前态势.md");
  const value = fauxOutput("chuangyi-xietiaoyuan", {
    project_state: { project: "demo-ruwen" },
  }) as Data;
  value.recipient = recipient;
  const payload = `治理/交接/${randomUUID()}.json`;
  await p.fs.write(payload, JSON.stringify(value.payload));
  const event = await approval.createEvent(
    p.fs,
    `dispatch-${randomUUID()}`,
    "handoff_execute",
    payload,
    true,
  );
  value.approval_ref = {
    path: String(event.event),
    sha256: await p.fs.sha256(String(event.event)),
  };
  const id = await p.service.enqueueDispatch(p.fs, value);
  await waitStatus(p.service, id, "AWAITING_PREVIEW_APPROVAL");
  expect(await p.fs.sha256("世界/当前态势.md")).toBe(world);
  const preview = await p.service.db.pool.query<{ status: string }>(
    "SELECT status FROM previews WHERE id=$1",
    [id],
  );
  expect(preview.rows[0]?.status).toBe("pending");
  await expect(p.service.enqueueDispatch(p.fs, value)).rejects.toThrow("批准");
  await p.service.handle({
    kind: "dispatch",
    projectId: p.fs.projectId,
    ownerId: p.fs.ownerId,
    runId: id,
  });
  expect(
    (
      await p.service.db.pool.query("SELECT 1 FROM role_runs WHERE run_id=$1", [
        id,
      ])
    ).rowCount,
  ).toBe(1);
}, 30000);
it("explicit compiler request creates a preview without changing the approved projection", async () => {
  const p = await fixture({}, true);
  cleanup.push(() => p.service.stop());
  const before = await state.loadState(p.fs);
  const id = await p.service.enqueueCompile(
    p.fs,
    "001",
    {
      project: "demo-ruwen",
      volume: "v1",
      arc: "station",
      chapter: "001",
      scene_type: "travel",
      pov: "林川",
    },
    ["粮车离开驿站"],
  );
  await waitStatus(p.service, id, "AWAITING_PREVIEW_APPROVAL");
  expect(await state.loadState(p.fs)).toEqual(before);
  const row = await p.service.db.pool.query<{ payload: Data }>(
    "SELECT payload FROM previews WHERE id=$1",
    [id],
  );
  expect(row.rows[0]?.payload.locked_events).toEqual(["粮车离开驿站"]);
}, 30000);
it("dispatch handoffs without an approval or with another project scope cannot be queued", async () => {
  const p = await fixture();
  cleanup.push(() => p.service.stop());
  const value = fauxOutput("chuangyi-xietiaoyuan", {
    project_state: { project: "demo-ruwen" },
  }) as Data;
  await expect(p.service.enqueueDispatch(p.fs, value)).rejects.toThrow("批准");
  value.scope = { project: "foreign" };
  await expect(p.service.enqueueDispatch(p.fs, value)).rejects.toThrow(
    "mismatch",
  );
  expect(
    (
      await p.service.db.pool.query(
        "SELECT 1 FROM pipeline_runs WHERE project_id=$1",
        [p.fs.projectId],
      )
    ).rowCount,
  ).toBe(0);
}, 30000);

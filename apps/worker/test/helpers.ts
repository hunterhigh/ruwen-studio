import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createFauxRuntime } from "@ruwen/agents";
import { exportProjectZip, importProjectZip, LocalDirFS } from "@ruwen/core";
import { PostgresFS } from "@ruwen/db";
import { inject } from "vitest";
import { type WorkerOptions, WorkerService } from "../src/service.ts";
export async function fixture(
  options: Partial<WorkerOptions> = {},
  consume = false,
) {
  const service = new WorkerService(inject("databaseUrl"), {
    runtime: createFauxRuntime,
    queue: `ruwen-test-${randomUUID()}`,
    heartbeatSeconds: 10,
    ...options,
  });
  await service.start(consume);
  const owner = randomUUID(),
    id = randomUUID();
  await service.db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    owner,
    `${owner}@test.invalid`,
  ]);
  await service.db.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'demo-ruwen','demo')",
    [id, owner],
  );
  const fs = new PostgresFS(service.db, id, owner);
  const source = new LocalDirFS(
    fileURLToPath(new URL("../../../fixtures/demo-project", import.meta.url)),
  );
  await importProjectZip(fs, await exportProjectZip(source));
  return { service, fs };
}
export async function waitStatus(
  service: WorkerService,
  id: string,
  status: string,
  timeout = 20000,
) {
  const start = performance.now();
  let last = "";
  while (performance.now() - start < timeout) {
    const row = await service.db.pool.query<{ status: string }>(
      "SELECT status FROM pipeline_runs WHERE id=$1",
      [id],
    );
    last = row.rows[0]?.status ?? "";
    if (last === status) return;
    if (
      ["FAILED", "FAILED_PRECONDITION", "CANCELLED"].includes(last) &&
      last !== status
    )
      throw new Error(`Unexpected ${last}; expected ${status}`);
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${status}; last ${last}`);
}

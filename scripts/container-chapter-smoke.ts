import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { WorkerService } from "../apps/worker/src/service.ts";
import { createFauxRuntime } from "../packages/agents/src/index.ts";
import { importProjectZip } from "../packages/core/src/index.ts";
import { PostgresFS } from "../packages/db/src/index.ts";

let producer: WorkerService | undefined;
let stage = "validate";
try {
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(process.env.RUN_CONTAINER_ACCEPTANCE, "1");
  assert.match(url.hostname, /^ruwen-ci-\d+-db$/);
  assert.equal(url.pathname, "/ruwen_staging");
  assert.equal(process.env.MODEL_MODE, "faux");
  stage = "producer_start";
  producer = new WorkerService(url.toString(), {
    runtime: createFauxRuntime,
    migrations: "verify",
    queue: process.env.WORKER_QUEUE ?? "ruwen-container-ci",
  });
  await producer.start(false);
  stage = "seed_project";
  const owner = randomUUID(),
    project = randomUUID();
  await producer.db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    owner,
    `${owner}@test.invalid`,
  ]);
  await producer.db.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'demo-ruwen','容器验证')",
    [project, owner],
  );
  const fs = new PostgresFS(producer.db, project, owner);
  stage = "import_archive";
  await importProjectZip(fs, await readFile("/app/fixtures/demo-project.zip"));
  stage = "enqueue";
  const run = await producer.enqueueChapter(fs, { chapter: 1 });
  stage = "approval_gate";
  let status = "";
  for (let n = 0; n < 120; n++) {
    status =
      (
        await producer.db.pool.query<{ status: string }>(
          "SELECT status FROM pipeline_runs WHERE id=$1",
          [run],
        )
      ).rows[0]?.status ?? "";
    if (
      status === "AWAITING_CANDIDATE_APPROVAL" ||
      ["FAILED", "FAILED_PRECONDITION", "RETURNED"].includes(status)
    )
      break;
    await delay(500);
  }
  assert.equal(status, "AWAITING_CANDIDATE_APPROVAL");
  stage = "usage_assertions";
  assert.equal(
    (
      await producer.db.pool.query(
        "SELECT count(*)::int n FROM role_runs WHERE run_id=$1 AND status='completed'",
        [run],
      )
    ).rows[0]?.n,
    5,
  );
  assert.equal(
    (
      await producer.db.pool.query(
        "SELECT count(*)::int n FROM credit_ledger WHERE user_id=$1 AND reason='role_usage'",
        [owner],
      )
    ).rows[0]?.n,
    5,
  );
  assert.equal(await fs.exists("chapters/0001.md"), false);
  process.stdout.write(
    '{"event":"readonly_faux_chapter_passed","approvalGate":true,"roles":5}\n',
  );
} catch {
  process.stdout.write(
    `${JSON.stringify({ event: "readonly_faux_chapter_failed", stage })}\n`,
  );
  process.exitCode = 1;
} finally {
  await producer?.stop();
}

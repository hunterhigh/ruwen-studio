import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WorkerService } from "../apps/worker/src/service.ts";
import { createFauxRuntime } from "../packages/agents/src/index.ts";
import {
  exportProjectZip,
  importProjectZip,
  LocalDirFS,
} from "../packages/core/src/index.ts";
import { PostgresFS } from "../packages/db/src/index.ts";

const env = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);
const url =
  process.env.DATABASE_URL ||
  "postgresql://ruwen:local_test_only@127.0.0.1:54329/ruwen_dev";
const parsed = new URL(url);
if (
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  parsed.pathname !== "/ruwen_dev"
)
  throw new Error("Demo bootstrap is restricted to local ruwen_dev");
const worker = new WorkerService(url, { runtime: createFauxRuntime });
await worker.start(false);
try {
  const owner = randomUUID(),
    project = randomUUID();
  await worker.db.pool.query(
    "INSERT INTO users(id,email,name) VALUES($1,$2,$3)",
    [owner, `${owner}@demo.invalid`, "本地演示用户"],
  );
  await worker.db.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'demo-ruwen','河谷驿站 · 演示')",
    [project, owner],
  );
  const fs = new PostgresFS(worker.db, project, owner);
  const source = new LocalDirFS(
    fileURLToPath(new URL("../fixtures/demo-project", import.meta.url)),
  );
  await importProjectZip(fs, await exportProjectZip(source));
  const runId = await worker.enqueueChapter(fs, { chapter: 1 });
  console.log(
    JSON.stringify(
      {
        ownerId: owner,
        projectId: project,
        runId,
        model: "worker根据MODEL_MODE运行；请使用faux",
        next: "启动worker后将在候选稿批准门等待；不自动批准正文。",
      },
      null,
      2,
    ),
  );
} finally {
  await worker.stop();
}

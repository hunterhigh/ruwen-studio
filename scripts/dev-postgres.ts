import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const directory = fileURLToPath(new URL("../.local/postgres", import.meta.url));
await mkdir(path.dirname(directory), { recursive: true });
// Public local-development credential; server only listens on loopback.
const cluster = new EmbeddedPostgres({
  databaseDir: directory,
  port: 54329,
  user: "ruwen",
  password: "local_test_only",
  persistent: true,
  createPostgresUser: false,
  autoRehydrateSymlinks: true,
  postgresFlags: ["-h", "127.0.0.1"],
  initdbFlags: ["--encoding=UTF8"],
  onLog: () => {},
  onError: () => {},
});
if (!existsSync(path.join(directory, "PG_VERSION"))) await cluster.initialise();
await cluster.start();
const client = cluster.getPgClient("postgres", "127.0.0.1");
await client.connect();
try {
  if (
    !(await client.query("SELECT 1 FROM pg_database WHERE datname='ruwen_dev'"))
      .rowCount
  )
    await client.query("CREATE DATABASE ruwen_dev");
} finally {
  await client.end();
}
console.log(
  "本地开发Postgres已启动（127.0.0.1:54329）。DATABASE_URL=postgresql://ruwen:local_test_only@127.0.0.1:54329/ruwen_dev",
);
console.log("保持此进程运行；Ctrl+C停止服务并保留项目数据。");
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await cluster.stop();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

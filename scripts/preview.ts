import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "../packages/db/src/index.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, ".local");
await mkdir(directory, { recursive: true });
const secretFile = path.join(directory, "preview-auth-secret");
try {
  await writeFile(secretFile, randomBytes(48).toString("hex"), {
    flag: "wx",
    mode: 0o600,
  });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
}
const port = process.env.PORT ?? "3000";
const environment: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: "postgresql://ruwen:local_test_only@127.0.0.1:54329/ruwen_dev",
  BETTER_AUTH_SECRET: (await readFile(secretFile, "utf8")).trim(),
  BETTER_AUTH_URL: `https://localhost:${port}`,
  MODEL_MODE: "faux",
  REAL_MODEL: "0",
  LOCAL_PREVIEW: "1",
  RUWEN_SKIP_ENV_FILE: "1",
  RUWEN_WORKSPACE_ROOT: root,
  WORKER_QUEUE: "ruwen-local-preview",
  P3_GATE_PASSED: "0",
  REAL_CHARGING_ENABLED: "0",
  NEXT_TELEMETRY_DISABLED: "1",
  ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? "preview@ruwen.local",
};
delete environment.ANTHROPIC_API_KEY;
const children: ChildProcess[] = [];
const child = (script: string, args: string[] = []) => {
  const process = spawn(globalThis.process.execPath, [script, ...args], {
    cwd: root,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  children.push(process);
  process.stdout?.pipe(globalThis.process.stdout);
  process.stderr?.pipe(globalThis.process.stderr);
  return process;
};
const db = new Database(environment.DATABASE_URL ?? "");
let running = false;
try {
  await db.pool.query("SELECT 1");
  running = true;
} catch {
  /* start the local cluster below */
} finally {
  await db.close();
}
if (!running) {
  const postgres = child("scripts/dev-postgres.ts");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Local Postgres did not start")),
      60000,
    );
    postgres.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("Postgres已启动")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    postgres.once("exit", () => {
      clearTimeout(timeout);
      reject(new Error("Local Postgres exited before ready"));
    });
  });
}
child("apps/worker/src/main.ts");
child("apps/web/scripts/server.ts", ["--dev"]);
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const process of children.toReversed()) process.kill("SIGTERM");
};
for (const process of children)
  process.on("exit", (code) => {
    if (!stopping) {
      console.error(
        `预览进程退出（${code ?? "signal"}），正在停止其他预览进程。`,
      );
      stop();
    }
  });
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

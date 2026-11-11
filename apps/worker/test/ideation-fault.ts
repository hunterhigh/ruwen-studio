import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Database } from "@ruwen/db";
import type { Task } from "../src/service.ts";

/** Native Node process death, followed by DB lock release, rather than a JS exception. */
export async function killIdeationAt(
  db: Database,
  projectId: string,
  task: Task,
  boundary: string,
  databaseUrl: string,
  queue: string,
) {
  const proc = spawn(
    process.execPath,
    [fileURLToPath(new URL("./ideation-child.ts", import.meta.url))],
    {
      env: {
        ...process.env,
        RUWEN_CHILD_DB: databaseUrl,
        RUWEN_CHILD_QUEUE: queue,
        RUWEN_CHILD_TASK: JSON.stringify(task),
        RUWEN_IDEATION_FAULT: boundary,
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  let stderr = "";
  proc.stderr?.on("data", (v) => {
    stderr += v.toString();
  });
  const closed = new Promise<void>((resolve) =>
    proc.on("exit", () => resolve()),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Missing checkpoint: ${stderr}`)),
        15000,
      );
      proc.on("message", (value) => {
        if ((value as { type: string }).type === "fault") {
          clearTimeout(timer);
          resolve();
        }
      });
      proc.on("exit", () => {
        clearTimeout(timer);
        reject(new Error(`Child exited: ${stderr}`));
      });
    });
  } finally {
    proc.kill("SIGKILL");
    await closed;
  }
  const deadline = Date.now() + 5000;
  while (true) {
    const client = await db.pool.connect();
    try {
      const acquired = (
        await client.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(hashtextextended($1,0)) locked",
          [`ruwen:project:${projectId}`],
        )
      ).rows[0]?.locked;
      if (acquired) {
        await client.query(
          "SELECT pg_advisory_unlock(hashtextextended($1,0))",
          [`ruwen:project:${projectId}`],
        );
        return;
      }
    } finally {
      client.release();
    }
    if (Date.now() > deadline)
      throw new Error("Dead worker lock was not released");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

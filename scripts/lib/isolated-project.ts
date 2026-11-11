import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { WorkerService } from "../../apps/worker/src/service.ts";
import {
  COORDINATOR_RECORDING_FORMAT,
  type ModelRuntime,
} from "../../packages/agents/src/index.ts";
import {
  exportProjectZip,
  importProjectZip,
  LocalDirFS,
} from "../../packages/core/src/index.ts";
import { PostgresFS } from "../../packages/db/src/index.ts";

/** Tool-owned disposable DB; never connects to a user's development/production DATABASE_URL. */
export async function isolatedDatabase() {
  const root = await mkdtemp(path.join(tmpdir(), "ruwen-tool-db-"));
  const port = await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string")
        return reject(new Error("Missing local port"));
      server.close(() => resolve(address.port));
    });
  });
  const password = randomBytes(24).toString("hex");
  const cluster = new EmbeddedPostgres({
    databaseDir: path.join(root, "data"),
    port,
    user: "postgres",
    password,
    persistent: true,
    createPostgresUser: false,
    autoRehydrateSymlinks: true,
    initdbFlags: ["--encoding=UTF8"],
    postgresFlags: ["-h", "127.0.0.1"],
    onLog: () => {},
    onError: () => {},
  });
  const close = async () => {
    await cluster.stop();
    if (
      path.dirname(root) !== path.resolve(tmpdir()) ||
      !path.basename(root).startsWith("ruwen-tool-db-")
    )
      throw new Error("Unsafe tool cleanup");
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 100,
    });
  };
  try {
    await cluster.initialise();
    await cluster.start();
    await cluster.createDatabase("ruwen_tool");
    return {
      url: `postgresql://postgres:${password}@127.0.0.1:${port}/ruwen_tool`,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function isolatedProject(url: string, runtime: ModelRuntime) {
  const service = new WorkerService(url, {
    runtime: () => runtime,
    queue: `ruwen-tool-${randomUUID()}`,
    ideation: { coordinatorRecordingFormat: COORDINATOR_RECORDING_FORMAT },
  });
  await service.start(false);
  try {
    const owner = randomUUID(),
      id = randomUUID();
    await service.db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
      owner,
      `${owner}@tool.invalid`,
    ]);
    await service.db.pool.query(
      "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'demo-ruwen','tool-demo')",
      [id, owner],
    );
    const fs = new PostgresFS(service.db, id, owner);
    const source = new LocalDirFS(
      fileURLToPath(new URL("../../fixtures/demo-project", import.meta.url)),
    );
    await importProjectZip(fs, await exportProjectZip(source));
    return { service, fs };
  } catch (error) {
    await service.stop();
    throw error;
  }
}

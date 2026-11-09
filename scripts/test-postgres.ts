import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import type { TestProject } from "vitest/node";
import { verifyPromptSources } from "../packages/agents/src/security/prompt-sources.ts";
import { Database } from "../packages/db/src/index.ts";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
export default async function setup(project: TestProject) {
  // Fail before fixtures/Python or a database start can obscure an upstream byte mismatch.
  await verifyPromptSources();
  let cluster: EmbeddedPostgres | undefined;
  let directory: string | undefined;
  let url = process.env.TEST_DATABASE_URL;
  const cleanup = async () => {
    if (cluster) await cluster.stop();
    if (directory) {
      const resolved = path.resolve(directory);
      if (
        path.dirname(resolved) !== path.resolve(tmpdir()) ||
        !path.basename(resolved).startsWith("ruwen-postgres-")
      )
        throw new Error("Unsafe test directory");
      await rm(resolved, {
        recursive: true,
        force: true,
        maxRetries: 8,
        retryDelay: 100,
      });
    }
  };
  try {
    if (!url) {
      directory = await mkdtemp(path.join(tmpdir(), "ruwen-postgres-"));
      const port = await new Promise<number>((resolve, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string")
            return reject(new Error("No test port"));
          server.close(() => resolve(address.port));
        });
      });
      const password = randomBytes(24).toString("hex");
      const errors: string[] = [];
      cluster = new EmbeddedPostgres({
        databaseDir: path.join(directory, "data"),
        port,
        user: "postgres",
        password,
        persistent: true,
        createPostgresUser: false,
        autoRehydrateSymlinks: true,
        initdbFlags: ["--encoding=UTF8"],
        postgresFlags: ["-h", "127.0.0.1"],
        onLog: () => {},
        onError: (error) => errors.push(String(error)),
      });
      try {
        await cluster.initialise();
        await cluster.start();
        await cluster.createDatabase("ruwen_test");
      } catch (error) {
        throw new Error(
          `Local PostgreSQL failed: ${String(error)} ${errors.join("\n")}`,
        );
      }
      url = `postgresql://postgres:${password}@127.0.0.1:${port}/ruwen_test`;
    }
    if (!/^ruwen_test(?:_|$)/.test(new URL(url).pathname.slice(1)))
      throw new Error("TEST_DATABASE_URL must name a ruwen_test database");
    const db = new Database(url);
    try {
      await db.migrate();
    } finally {
      await db.close();
    }
    project.provide("databaseUrl", url);
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

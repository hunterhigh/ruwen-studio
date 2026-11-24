import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type PoolClient } from "pg";
import * as schema from "./schema.ts";

const connectionCodes = new Set([
  "57P01",
  "57P02",
  "57P03",
  "57P04",
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ENOTFOUND",
]);

function errorCode(error: unknown): string | undefined {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
}

function connectionFailure(error: unknown): error is Error {
  if (!(error instanceof Error)) return false;
  const code = errorCode(error);
  return (
    ("severity" in error &&
      (error.severity === "FATAL" || error.severity === "PANIC")) ||
    (code !== undefined &&
      (connectionCodes.has(code) || /^08[A-Z0-9]{3}$/.test(code)))
  );
}

function logConnectionError(
  source: "idle_pool" | "checked_out" | "rollback",
  error: unknown,
) {
  const code = errorCode(error);
  process.stderr.write(
    `${JSON.stringify({
      event: "postgres_connection_error",
      source,
      ...(code && connectionCodes.has(code) ? { error_code: code } : {}),
    })}\n`,
  );
}

export class Database {
  readonly pool: pg.Pool;
  readonly orm;
  private readonly socketEnds = new Map<PoolClient, Promise<void>>();
  private closing: Promise<void> | undefined;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 12,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    });
    this.pool.on("error", (error) => logConnectionError("idle_pool", error));
    this.pool.on("connect", (client) => {
      this.socketEnds.set(
        client,
        new Promise<void>((resolve) => {
          client.once("end", () => {
            this.socketEnds.delete(client);
            resolve();
          });
        }),
      );
    });
    this.orm = drizzle(this.pool, { schema });
  }
  async checkout(onDisconnect?: (error: Error) => void) {
    const client = await this.pool.connect();
    let connectionError: Error | undefined;
    const onError = (error: Error) => {
      if (connectionError) return;
      connectionError = error;
      logConnectionError("checked_out", error);
      onDisconnect?.(error);
    };
    client.on("error", onError);
    return {
      client,
      get error() {
        return connectionError;
      },
      release(error?: Error) {
        client.release(connectionError ?? error);
        client.off("error", onError);
      },
    };
  }
  async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    options: { readOnly?: boolean } = {},
  ): Promise<T> {
    const session = await this.checkout();
    const { client } = session;
    let discard: Error | undefined;
    try {
      await client.query(
        options.readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN",
      );
      const value = await fn(client);
      if (session.error) throw session.error;
      await client.query("COMMIT");
      return value;
    } catch (error) {
      if (connectionFailure(error)) discard = error;
      if (!discard && !session.error) {
        try {
          const rollback = { text: "ROLLBACK", query_timeout: 5000 };
          await client.query(rollback);
        } catch (rollbackError) {
          discard =
            rollbackError instanceof Error
              ? rollbackError
              : new Error("PostgreSQL rollback failed");
          logConnectionError("rollback", rollbackError);
        }
      }
      throw error;
    } finally {
      session.release(discard);
    }
  }
  async migrate(): Promise<void> {
    const directory = new URL("../migrations/", import.meta.url);
    const files = (await readdir(directory))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    await this.transaction(async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('ruwen:migrations',0))",
      );
      await client.query(
        "CREATE TABLE IF NOT EXISTS ruwen_migrations (id text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const file of files) {
        const id = file.slice(0, 4),
          source = await readFile(new URL(file, directory), "utf8");
        const hash = createHash("sha256").update(source).digest("hex");
        const existing = await client.query<{ sha256: string }>(
          "SELECT sha256 FROM ruwen_migrations WHERE id=$1",
          [id],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].sha256 !== hash)
            throw new Error("Applied migration was modified");
          continue;
        }
        await client.query(source);
        await client.query(
          "INSERT INTO ruwen_migrations(id,sha256) VALUES($1,$2)",
          [id, hash],
        );
      }
    });
  }
  /** Production startup verifies immutable migrations; only the release step may apply DDL. */
  async verifyMigrations(): Promise<void> {
    const directory = new URL("../migrations/", import.meta.url);
    const files = (await readdir(directory))
      .filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort();
    const applied = await this.pool.query<{ id: string; sha256: string }>(
      "SELECT id,sha256 FROM ruwen_migrations",
    );
    const hashes = new Map(applied.rows.map((row) => [row.id, row.sha256]));
    for (const file of files) {
      const content = await readFile(new URL(file, directory));
      if (
        hashes.get(file.slice(0, 4)) !==
        createHash("sha256").update(content).digest("hex")
      )
        throw new Error("Database migration step is required");
    }
  }
  close() {
    // pg-pool removes idle clients before their sockets end.
    this.closing ??= this.pool.end().then(async () => {
      await Promise.all(this.socketEnds.values());
    });
    return this.closing;
  }
}

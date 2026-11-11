import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import pg, { type PoolClient } from "pg";
import * as schema from "./schema.ts";
export class Database {
  readonly pool: pg.Pool;
  readonly orm;
  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      max: 12,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 10000,
    });
    this.orm = drizzle(this.pool, { schema });
  }
  async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    options: { readOnly?: boolean } = {},
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(
        options.readOnly
          ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"
          : "BEGIN",
      );
      const value = await fn(client);
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
    return this.pool.end();
  }
}

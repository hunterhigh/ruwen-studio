import path from "node:path";
import { AlreadyExists, type ProjectFS, UnsafePath } from "@ruwen/core";
import type { PoolClient, QueryResultRow } from "pg";
import { compareStrings } from "../../core/src/fs/order.ts";
import type { Database } from "./database.ts";
export class TenantAccessError extends Error {}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export class PostgresFS implements ProjectFS {
  readonly root: string;
  readonly projectId: string;
  readonly ownerId: string;
  private db: Database;
  private client: PoolClient | undefined;
  private closed = false;
  private savepoints = { value: 0, tail: Promise.resolve() };
  constructor(
    db: Database,
    projectId: string,
    ownerId: string,
    client?: PoolClient,
    savepoints?: { value: number; tail: Promise<void> },
  ) {
    if (!uuid.test(projectId) || !uuid.test(ownerId))
      throw new TenantAccessError("Invalid project identity");
    this.db = db;
    this.projectId = projectId;
    this.ownerId = ownerId;
    this.client = client;
    this.root = `/projects/${projectId}`;
    if (savepoints) this.savepoints = savepoints;
  }
  path(value: string): string {
    if (typeof value !== "string" || value.includes("\0"))
      throw new UnsafePath("Invalid project path");
    const raw = value.replaceAll("\\", "/");
    const absolute = path.posix.resolve(this.root, raw);
    if (absolute !== this.root && !absolute.startsWith(`${this.root}/`))
      throw new UnsafePath("Path escapes project root");
    const relative =
      absolute === this.root ? "" : absolute.slice(this.root.length + 1);
    for (const part of relative.split("/").filter(Boolean))
      if (
        /[<>:"|?*]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
      )
        throw new UnsafePath("Nonportable or reserved project path");
    return relative;
  }
  // Durable evidence uses logical paths, so exported projects remain portable.
  displayPath(value: string) {
    return this.path(value);
  }
  async sql<T extends QueryResultRow = QueryResultRow>(
    query: string,
    values: unknown[] = [],
  ) {
    if (this.closed) throw new Error("Transaction is already closed");
    if (!this.client) throw new Error("SQL requires a project transaction");
    const client = this.client;
    const result = this.savepoints.tail.then(() => {
      if (this.closed) throw new Error("Transaction is already closed");
      return client.query<T>(query, values);
    });
    this.savepoints.tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  async transaction<T>(fn: (tx: PostgresFS) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error("Transaction is already closed");
    if (this.client) {
      const savepoint = `ruwen_${++this.savepoints.value}`;
      await this.client.query(`SAVEPOINT ${savepoint}`);
      const tx = new PostgresFS(
        this.db,
        this.projectId,
        this.ownerId,
        this.client,
        this.savepoints,
      );
      try {
        const result = await fn(tx);
        await this.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        await this.client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await this.client.query(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      } finally {
        tx.closed = true;
      }
    }
    return this.db.transaction(async (client) => {
      const access = await client.query(
        "SELECT id FROM projects WHERE id=$1 AND owner_id=$2 FOR UPDATE",
        [this.projectId, this.ownerId],
      );
      if (!access.rowCount)
        throw new TenantAccessError(
          "Project does not exist or belongs to another user",
        );
      const tx = new PostgresFS(this.db, this.projectId, this.ownerId, client);
      try {
        return await fn(tx);
      } finally {
        tx.closed = true;
      }
    });
  }
  private use<T>(fn: (tx: PostgresFS) => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Transaction is already closed"));
    return this.client ? fn(this) : this.transaction(fn);
  }
  private useRead<T>(fn: (tx: PostgresFS) => Promise<T>): Promise<T> {
    if (this.closed)
      return Promise.reject(new Error("Transaction is already closed"));
    if (this.client) return fn(this);
    // Ownership and file bytes share an MVCC snapshot; no row lock waits behind writers.
    return this.db.transaction(
      async (client) => {
        const access = await client.query(
          "SELECT id FROM projects WHERE id=$1 AND owner_id=$2",
          [this.projectId, this.ownerId],
        );
        if (!access.rowCount)
          throw new TenantAccessError(
            "Project does not exist or belongs to another user",
          );
        const tx = new PostgresFS(
          this.db,
          this.projectId,
          this.ownerId,
          client,
        );
        try {
          return await fn(tx);
        } finally {
          tx.closed = true;
        }
      },
      { readOnly: true },
    );
  }
  read(value: string): Promise<Uint8Array> {
    return this.useRead(async (tx) => {
      const p = this.path(value);
      const result = await tx.sql<{ content: Buffer }>(
        "SELECT content FROM project_files WHERE project_id=$1 AND path=$2",
        [this.projectId, p],
      );
      if (!result.rows[0])
        throw Object.assign(new Error(`Missing project file: ${p}`), {
          code: "ENOENT",
        });
      return new Uint8Array(result.rows[0].content);
    });
  }
  async readText(value: string) {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      await this.read(value),
    );
  }
  private put(
    value: string,
    data: Uint8Array | string,
    exclusive: boolean,
  ): Promise<void> {
    return this.use(async (tx) => {
      const p = this.path(value);
      if (!p) throw new UnsafePath("Cannot write a directory");
      const conflict = await tx.sql(
        "SELECT path FROM project_files WHERE project_id=$1 AND path<>$2 AND (left(path,length($2)+1)=$2||'/' OR left($2,length(path)+1)=path||'/') LIMIT 1",
        [this.projectId, p],
      );
      if (conflict.rowCount)
        throw new UnsafePath("Path conflicts with a file or directory");
      const bytes = Buffer.from(
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
      const result = await tx.sql(
        `INSERT INTO project_files(project_id,path,content) VALUES($1,$2,$3) ON CONFLICT(project_id,path) ${exclusive ? "DO NOTHING" : "DO UPDATE SET content=excluded.content,updated_at=now()"} RETURNING path`,
        [this.projectId, p, bytes],
      );
      if (!result.rowCount) throw new AlreadyExists(`Already exists: ${p}`);
      await tx.indexApproval(p, bytes);
    });
  }
  write(value: string, data: Uint8Array | string) {
    return this.put(value, data, false);
  }
  createExclusive(value: string, data: Uint8Array | string) {
    return this.put(value, data, true);
  }
  exists(value: string): Promise<boolean> {
    return this.useRead(async (tx) =>
      Boolean(
        (
          await tx.sql(
            "SELECT 1 FROM project_files WHERE project_id=$1 AND path=$2",
            [this.projectId, this.path(value)],
          )
        ).rowCount,
      ),
    );
  }
  list(prefix = ""): Promise<string[]> {
    return this.useRead(async (tx) => {
      const p = this.path(prefix);
      const result = await tx.sql<{ path: string }>(
        "SELECT path FROM project_files WHERE project_id=$1 AND ($2='' OR path=$2 OR left(path,length($2)+1)=$2||'/')",
        [this.projectId, p],
      );
      return result.rows.map((r) => r.path).sort(compareStrings);
    });
  }
  remove(value: string): Promise<void> {
    return this.use(async (tx) => {
      const p = this.path(value);
      await tx.sql(
        "DELETE FROM project_files WHERE project_id=$1 AND path=$2",
        [this.projectId, p],
      );
      await tx.sql(
        "DELETE FROM approval_events WHERE project_id=$1 AND event_path=$2",
        [this.projectId, p],
      );
    });
  }
  sha256(value: string): Promise<string> {
    return this.useRead(async (tx) => {
      const result = await tx.sql<{ sha256: string }>(
        "SELECT sha256 FROM project_files WHERE project_id=$1 AND path=$2",
        [this.projectId, this.path(value)],
      );
      if (!result.rows[0]) throw new Error(`Missing project file: ${value}`);
      return result.rows[0].sha256;
    });
  }
  private async indexApproval(p: string, bytes: Buffer) {
    if (!/^治理\/审批\/(?:已使用\/)?[^/.][^/]*\.json$/.test(p)) return;
    let value: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return;
      value = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    if (p.startsWith("治理/审批/已使用/")) {
      if (typeof value.event_id === "string")
        await this.sql(
          "UPDATE approval_events SET consumed_at=coalesce(consumed_at,now()) WHERE project_id=$1 AND id=$2",
          [this.projectId, value.event_id],
        );
    } else if (
      ["id", "action", "target_path", "target_sha256"].every(
        (key) => typeof value[key] === "string",
      )
    ) {
      await this.sql(
        "INSERT INTO approval_events(id,project_id,event_path,action,target_path,target_sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(project_id,id) DO UPDATE SET event_path=excluded.event_path,action=excluded.action,target_path=excluded.target_path,target_sha256=excluded.target_sha256",
        [
          value.id,
          this.projectId,
          p,
          value.action,
          value.target_path,
          value.target_sha256,
          this.ownerId,
        ],
      );
    }
  }
}

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, open, stat } from "node:fs/promises";
import path from "node:path";
import { Database } from "../../packages/db/src/index.ts";

export function postgresEnvironment(connectionString: string) {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  )
    throw new Error("A PostgreSQL connection is required");
  return {
    ...process.env,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    ...(url.searchParams.has("sslmode")
      ? { PGSSLMODE: url.searchParams.get("sslmode") ?? "verify-full" }
      : {}),
  };
}
async function pgTool(
  name: "pg_dump" | "pg_restore",
  args: string[],
  url: string,
) {
  const executable = `${name}${process.platform === "win32" ? ".exe" : ""}`;
  const binary = process.env.PG_BIN
    ? path.join(path.resolve(process.env.PG_BIN), executable)
    : executable;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      env: postgresEnvironment(url),
      windowsHide: true,
      shell: false,
      // Native diagnostics can contain DSNs, SQL and row values. Never forward them into logs.
      stdio: ["ignore", "ignore", "pipe"],
    });
    let diagnostic = "";
    child.stderr.on("data", (bytes: Buffer) => {
      if (diagnostic.length < 8192) diagnostic += bytes.toString();
    });
    child.once("error", () =>
      reject(new Error("PostgreSQL backup tool unavailable")),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `PostgreSQL backup tool failed (${name}, ${code}, ${/version mismatch|server version/i.test(diagnostic) ? "version" : /connect|authentication/i.test(diagnostic) ? "connection" : /permission denied|could not open/i.test(diagnostic) ? "filesystem" : /generated column/i.test(diagnostic) ? "generated-column" : /configuration parameter/i.test(diagnostic) ? "configuration" : /already exists/i.test(diagnostic) ? "existing-object" : /does not exist/i.test(diagnostic) ? "missing-object" : "database"}); native content was withheld`,
            ),
          ),
    );
  });
}
export async function backupDatabase(
  connectionString: string,
  destination: string,
) {
  postgresEnvironment(connectionString);
  const target = path.resolve(destination);
  const file = await open(target, "wx", 0o600);
  await file.close();
  await pgTool(
    "pg_dump",
    ["--format=custom", "--file", target],
    connectionString,
  );
  await chmod(target, 0o600);
  if (!(await stat(target)).size) throw new Error("Empty backup");
  return target;
}
/** Creates a NEW database only. No --clean, DROP, overwrite or automatic application startup. */
export async function restoreNewDatabase(
  connectionString: string,
  archive: string,
  confirmation: string,
) {
  const url = new URL(connectionString);
  postgresEnvironment(connectionString);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !/^ruwen_restore_[a-z0-9_]{1,40}$/.test(database) ||
    confirmation !== database
  )
    throw new Error(
      "Restore requires a new ruwen_restore_* database and matching explicit confirmation",
    );
  if (!(await stat(path.resolve(archive))).isFile())
    throw new Error("Backup archive required");
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new Database(adminUrl.toString());
  try {
    if (
      (
        await admin.pool.query("SELECT 1 FROM pg_database WHERE datname=$1", [
          database,
        ])
      ).rowCount
    )
      throw new Error("Restore target already exists; refusing overwrite");
    await admin.pool.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.close();
  }
  await pgTool(
    "pg_restore",
    [
      "--single-transaction",
      "--exit-on-error",
      "--no-owner",
      "--no-acl",
      "--dbname",
      database,
      path.resolve(archive),
    ],
    url.toString(),
  );
}
/** Read-only business-state comparison; neither row content nor per-user facts leave this function. */
export async function databaseFingerprint(connectionString: string) {
  const db = new Database(connectionString);
  try {
    return await db.transaction(
      async (tx) => {
        const tables = await tx.query<{ tablename: string }>(
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
        );
        const hash = createHash("sha256");
        let rows = 0;
        for (const { tablename } of tables.rows) {
          if (!/^[a-z_][a-z0-9_]*$/.test(tablename))
            throw new Error("Unexpected business table identifier");
          const facts = await tx.query<{ hash: string }>(
            `SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') hash FROM "${tablename}" t ORDER BY 1`,
          );
          hash.update(`${tablename}\n${facts.rowCount}\n`);
          for (const fact of facts.rows) hash.update(`${fact.hash}\n`);
          rows += facts.rows.length;
        }
        const valid = await tx.query<{ valid: boolean }>(
          "SELECT coalesce(bool_and(encode(sha256(content),'hex')=sha256),true) valid FROM project_files",
        );
        if (!valid.rows[0]?.valid)
          throw new Error("Project file content hash mismatch");
        return {
          sha256: hash.digest("hex"),
          tables: tables.rows.length,
          rows,
          projectFileHashesValid: true,
        };
      },
      { readOnly: true },
    );
  } finally {
    await db.close();
  }
}

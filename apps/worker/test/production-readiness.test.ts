import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFauxRuntime } from "@ruwen/agents";
import { balance, initializeBilling } from "@ruwen/billing";
import * as Sentry from "@sentry/node";
import { afterAll, expect, inject, it, vi } from "vitest";
import { databaseReady, workerHealth } from "../../../config/health.ts";
import {
  initializeObservability,
  safeLogRecord,
  safeSentryEvent,
} from "../../../config/observability.ts";
import { proxyClientIp, proxyConfiguration } from "../../../config/proxy.ts";
import { Database } from "../../../packages/db/src/index.ts";
import {
  backupDatabase,
  databaseFingerprint,
  postgresEnvironment,
  restoreNewDatabase,
} from "../../../scripts/lib/database-backup.ts";
import { freezeForOperations } from "../../../scripts/lib/freeze-account.ts";
import { WorkerService } from "../src/service.ts";
import { fixture } from "./helpers.ts";

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn(async () => true),
}));
const dbs: Database[] = [];
afterAll(async () => {
  await Promise.all(dbs.map((db) => db.close()));
});
function database() {
  const db = new Database(inject("databaseUrl"));
  dbs.push(db);
  return db;
}
it("production verifies migration hashes, refuses missing migration and never runs the application migrator", async () => {
  const db = database();
  await db.verifyMigrations();
  const bootstrap = new WorkerService(inject("databaseUrl"), {
    runtime: createFauxRuntime,
    migrations: "apply",
    queue: `migration-bootstrap-${randomUUID()}`,
  });
  await bootstrap.start(false);
  await bootstrap.stop();
  const worker = new WorkerService(inject("databaseUrl"), {
    runtime: createFauxRuntime,
    migrations: "verify",
    queue: `production-test-${randomUUID()}`,
  });
  const migrate = vi.spyOn(worker.db, "migrate");
  await worker.start(false);
  expect(migrate).not.toHaveBeenCalled();
  await worker.stop();
  const query = vi
    .spyOn(db.pool, "query")
    .mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);
  await expect(db.verifyMigrations()).rejects.toThrow(
    "migration step is required",
  );
  expect(query).toHaveBeenCalledWith("SELECT id,sha256 FROM ruwen_migrations");
});
it("worker health is non-ready before startup/while stopping, verifies DB, rejects other routes and exposes no diagnostics", async () => {
  const db = database(),
    health = workerHealth(db, 0);
  await health.listen();
  const address = health.server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing probe port");
  const url = `http://127.0.0.1:${address.port}/health`;
  try {
    expect((await fetch(url)).status).toBe(503);
    health.setReady(true);
    expect(await (await fetch(url)).json()).toEqual({ ok: true });
    expect((await fetch(`${url}/not-a-probe`)).status).toBe(404);
    vi.spyOn(db.pool, "query").mockRejectedValueOnce(
      new Error("postgres://secret manuscript"),
    );
    const failed = await fetch(url);
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('{"ok":false}');
    health.setReady(false);
    expect((await fetch(url)).status).toBe(503);
  } finally {
    await health.close();
  }
  expect(await databaseReady(db)).toBe(true);
});
it("proxy mode is explicit, checks socket CIDRs and platform IP only; direct HTTPS ignores every forwarded header", () => {
  expect(
    proxyClientIp(null, "::ffff:127.0.0.1", {
      "x-forwarded-for": "203.0.113.9",
    }),
  ).toBe("127.0.0.1");
  const env = {
    HTTP_FROM_PROXY: "1",
    TRUST_PROXY_PROVIDER: "fly",
    TRUSTED_PROXY_CIDRS: "127.0.0.1/32,::1/128",
    BETTER_AUTH_URL: "https://studio.test.invalid",
  };
  const config = proxyConfiguration(env);
  expect(
    proxyClientIp(config, "127.0.0.1", {
      "fly-client-ip": "203.0.113.8",
      "x-forwarded-for": "192.0.2.1",
    }),
  ).toBe("203.0.113.8");
  expect(() =>
    proxyClientIp(config, "192.0.2.4", { "fly-client-ip": "203.0.113.8" }),
  ).toThrow("Untrusted");
  expect(() =>
    proxyClientIp(config, "::1", { "fly-client-ip": "secret-or-body" }),
  ).toThrow("platform client IP");
  const railway = proxyConfiguration({
    ...env,
    TRUST_PROXY_PROVIDER: "railway",
  });
  expect(proxyClientIp(railway, "::1", { "x-real-ip": "203.0.113.5" })).toBe(
    "203.0.113.5",
  );
  for (const overrides of [
    { TRUSTED_PROXY_CIDRS: "" },
    { TRUSTED_PROXY_CIDRS: "0.0.0.0/0" },
    { TRUST_PROXY_PROVIDER: "anything" },
    { BETTER_AUTH_URL: "http://studio.test.invalid" },
  ])
    expect(() => proxyConfiguration({ ...env, ...overrides })).toThrow();
});
it("logs and Sentry omit keys, manuscript, HTTP/SQL/stack and disable every content collection category; empty DSN never initializes", () => {
  expect(initializeObservability({})).toBe(false);
  expect(Sentry.init).not.toHaveBeenCalled();
  const secret = "sk-ant-secret-DO-NOT-LOG",
    manuscript = "正文哨兵不可进入日志或监测";
  const id = randomUUID();
  expect(
    safeLogRecord("worker_error", {
      run_id: id,
      role_id: "xiaoshuo-zuozhe",
      api_key: secret,
      text: manuscript,
      error: new Error(secret),
      error_type: "Error",
      duration_ms: 12,
    }),
  ).toEqual({
    event: "worker_error",
    run_id: id,
    role_id: "xiaoshuo-zuozhe",
    error_type: "Error",
    duration_ms: 12,
  });
  const event = safeSentryEvent({
    type: undefined,
    message: manuscript,
    event_id: secret,
    request: { data: manuscript, headers: { Authorization: secret } },
    extra: { sql: secret },
    user: { email: secret },
    exception: { values: [{ value: manuscript }] },
    tags: { event: "worker_error", run_id: id, role_id: secret },
  });
  expect(JSON.stringify(event)).not.toContain(secret);
  expect(JSON.stringify(event)).not.toContain(manuscript);
  expect(event).not.toHaveProperty("request");
  expect(event).not.toHaveProperty("exception");
  expect(
    initializeObservability({
      SENTRY_DSN: "https://unit-test@example.invalid/1",
    }),
  ).toBe(true);
  const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
  expect(options?.defaultIntegrations).toBe(false);
  expect(options?.dataCollection).toMatchObject({
    userInfo: false,
    httpBodies: [],
    genAI: { inputs: false, outputs: false },
    databaseQueryData: false,
  });
  expect(() =>
    initializeObservability({ SENTRY_DSN: "http://example.invalid/1" }),
  ).toThrow("HTTPS");
});
it("operator freeze requires an allowlisted actor and atomically retains risk audit without changing credit history", async () => {
  const p = await fixture(),
    actor = randomUUID();
  try {
    await p.service.db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
      actor,
      `${actor}@test.invalid`,
    ]);
    const before = await balance(p.service.db.pool, p.fs.ownerId, "sandbox");
    await expect(
      freezeForOperations(p.service.db, p.fs.ownerId, actor, []),
    ).rejects.toThrow("administrator");
    expect(
      (
        await p.service.db.pool.query(
          "SELECT frozen_at FROM billing_accounts WHERE user_id=$1",
          [p.fs.ownerId],
        )
      ).rows[0]?.frozen_at,
    ).toBeNull();
    await freezeForOperations(p.service.db, p.fs.ownerId, actor, [
      `${actor}@test.invalid`,
    ]);
    expect(
      (
        await p.service.db.pool.query(
          "SELECT action,actor_id FROM account_risk_audit WHERE user_id=$1",
          [p.fs.ownerId],
        )
      ).rows,
    ).toEqual([{ action: "freeze", actor_id: actor }]);
    await expect(
      p.service.enqueueChapter(p.fs, { chapter: 1 }),
    ).rejects.toMatchObject({ code: "ACCOUNT_FROZEN" });
    expect(await balance(p.service.db.pool, p.fs.ownerId, "sandbox")).toEqual(
      before,
    );
  } finally {
    await p.service.stop();
  }
});
it("real pg_dump/pg_restore restores business rows, file hashes, approvals and credit ledger to a new DB and refuses overwrite", async () => {
  const oldBin = process.env.PG_BIN;
  const sourceUrl = new URL(inject("databaseUrl"));
  sourceUrl.pathname = `/ruwen_test_backup_${randomUUID().replaceAll("-", "")}`;
  const admin = database();
  await admin.pool.query(`CREATE DATABASE "${sourceUrl.pathname.slice(1)}"`);
  const source = sourceUrl.toString(),
    sourceDb = new Database(source);
  dbs.push(sourceDb);
  await sourceDb.migrate();
  await initializeBilling(sourceDb);
  const user = randomUUID(),
    project = randomUUID();
  await sourceDb.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    user,
    `${user}@test.invalid`,
  ]);
  await sourceDb.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'restore-test','恢复演练')",
    [project, user],
  );
  await sourceDb.pool.query(
    "INSERT INTO project_files(project_id,path,content) VALUES($1,'chapters/0001.md',$2)",
    [project, Buffer.from("恢复演练正文\n第二行。")],
  );
  await sourceDb.pool.query(
    "INSERT INTO approval_events(id,project_id,event_path,action,target_path,target_sha256,created_by,consumed_at) SELECT $1,$2,'治理/审批/restore.json','candidate_approve',path,sha256,$3,now() FROM project_files WHERE project_id=$2",
    [randomUUID(), project, user],
  );
  await sourceDb.pool.query(
    "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'sandbox',-17,'role_usage','restore-fixture',$2)",
    [user, randomUUID()],
  );
  const expected = await databaseFingerprint(source);
  const target = new URL(source);
  const name = `ruwen_restore_test_${randomUUID().replaceAll("-", "")}`;
  target.pathname = `/${name}`;
  const directory = await mkdtemp(path.join(tmpdir(), "ruwen-backup-test-"));
  const archive = path.join(directory, "database.dump");
  try {
    await backupDatabase(source, archive);
    await expect(backupDatabase(source, archive)).rejects.toThrow();
    await restoreNewDatabase(target.toString(), archive, name);
    const restored = await databaseFingerprint(target.toString());
    expect(restored).toEqual(expected);
    const restoredDb = new Database(target.toString());
    dbs.push(restoredDb);
    expect(await balance(restoredDb.pool, user, "sandbox")).toEqual(
      await balance(sourceDb.pool, user, "sandbox"),
    );
    expect(
      (
        await restoredDb.pool.query(
          "SELECT consumed_at IS NOT NULL used FROM approval_events WHERE project_id=$1",
          [project],
        )
      ).rows,
    ).toEqual([{ used: true }]);
    await expect(
      restoreNewDatabase(target.toString(), archive, name),
    ).rejects.toThrow("already exists");
    await expect(restoreNewDatabase(source, archive, name)).rejects.toThrow(
      "matching explicit confirmation",
    );
    const connection = postgresEnvironment(source);
    expect(connection.PGDATABASE).toMatch(/^ruwen_test/);
    expect(connection).toHaveProperty("PGPASSWORD");
  } finally {
    if (oldBin === undefined) delete process.env.PG_BIN;
    else process.env.PG_BIN = oldBin;
  }
}, 60000);

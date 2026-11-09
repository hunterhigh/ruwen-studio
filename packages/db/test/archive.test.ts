import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  checks,
  exportProjectZip,
  importProjectZip,
  LocalDirFS,
} from "@ruwen/core";
import { afterAll, expect, inject, it } from "vitest";
import { Database, PostgresFS } from "../src/index.ts";

const db = new Database(inject("databaseUrl"));
afterAll(() => db.close());
async function empty() {
  const owner = randomUUID(),
    id = randomUUID();
  await db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    owner,
    `${owner}@test.invalid`,
  ]);
  await db.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'demo-ruwen','demo')",
    [id, owner],
  );
  return new PostgresFS(db, id, owner);
}
it("export → Postgres import → export preserves all raw bytes, approvals and readiness", async () => {
  const source = new LocalDirFS(
    fileURLToPath(new URL("../../../fixtures/demo-project", import.meta.url)),
  );
  const target = await empty();
  const archive = await exportProjectZip(source);
  await importProjectZip(target, archive);
  expect(await target.list()).toEqual(await source.list());
  for (const p of await source.list())
    expect(await target.sha256(p), p).toBe(await source.sha256(p));
  expect((await checks.projectReadiness(target)).ready).toBe(true);
  await target.write(
    "研究/原始字节.bin",
    new Uint8Array([0, 255, 128, 13, 10]),
  );
  const other = await empty();
  await importProjectZip(other, await exportProjectZip(target));
  for (const p of await target.list())
    expect(await other.sha256(p)).toBe(await target.sha256(p));
  await expect(importProjectZip(target, archive)).rejects.toThrow(
    "empty project",
  );
}, 20000);
it("malformed archives fail without changing the target", async () => {
  const target = await empty();
  await expect(
    importProjectZip(target, new TextEncoder().encode("not a zip")),
  ).rejects.toThrow();
  expect(await target.list()).toEqual([]);
});

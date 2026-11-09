import { createHash, randomUUID } from "node:crypto";
import { getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, expect, inject, it } from "vitest";
import { projectFSContract } from "../../core/test/fs-contract.ts";
import { Database, PostgresFS, schema } from "../src/index.ts";

const db = new Database(inject("databaseUrl"));
afterAll(() => db.close());
async function create() {
  const owner = randomUUID(),
    id = randomUUID();
  await db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    owner,
    `${owner}@test.invalid`,
  ]);
  await db.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'db-test','test')",
    [id, owner],
  );
  return new PostgresFS(db, id, owner);
}
projectFSContract("PostgresFS", create);
it("Drizzle table columns agree with the applied SQL migration", async () => {
  for (const table of Object.values(schema)) {
    const config = getTableConfig(table);
    const result = await db.pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1",
      [config.name],
    );
    expect(
      result.rows.map((row) => row.column_name).sort(),
      config.name,
    ).toEqual(config.columns.map((column) => column.name).sort());
  }
});
it("owner isolation applies to every file operation and nested transaction", async () => {
  const fs = await create();
  await fs.write("private", "secret");
  const foreign = new PostgresFS(db, fs.projectId, randomUUID());
  for (const fn of [
    () => foreign.read("private"),
    () => foreign.write("private", "bad"),
    () => foreign.exists("private"),
    () => foreign.list(),
    () => foreign.remove("private"),
    () => foreign.sha256("private"),
    () => foreign.transaction(async () => {}),
  ])
    await expect(fn()).rejects.toThrow("another user");
  expect(await fs.readText("private")).toBe("secret");
});
it("database hashes raw bytes and history rolls back with failed transactions", async () => {
  const fs = await create();
  await fs.write("a", "old\r\n");
  expect(await fs.sha256("a")).toBe(
    createHash("sha256").update("old\r\n").digest("hex"),
  );
  await expect(
    fs.transaction(async (tx) => {
      await tx.write("a", "discard");
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(
    (
      await db.pool.query(
        "SELECT * FROM project_file_history WHERE project_id=$1",
        [fs.projectId],
      )
    ).rowCount,
  ).toBe(0);
  await fs.write("a", "new");
  const history = await db.pool.query<{ content: Buffer }>(
    "SELECT content FROM project_file_history WHERE project_id=$1",
    [fs.projectId],
  );
  expect(history.rows[0]?.content.toString()).toBe("old\r\n");
  expect(await fs.readText("a")).toBe("new");
});
it("append-only credit ledger refuses updates and deletions", async () => {
  const fs = await create();
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO credit_ledger(id,user_id,delta_credits,reason,ref_type,ref_id) VALUES($1,$2,1,'test','test','test')",
    [id, fs.ownerId],
  );
  await expect(
    db.pool.query("UPDATE credit_ledger SET delta_credits=10 WHERE id=$1", [
      id,
    ]),
  ).rejects.toThrow("append-only");
  await expect(
    db.pool.query("DELETE FROM credit_ledger WHERE id=$1", [id]),
  ).rejects.toThrow("append-only");
});

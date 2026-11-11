import { initializeBilling } from "@ruwen/billing";
import { Database } from "@ruwen/db";
import { PgBoss } from "pg-boss";

// Explicit release step. Never loads .env or starts consumers/models.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const db = new Database(connectionString);
const boss = new PgBoss({ connectionString, migrate: true, supervise: false });
try {
  await db.migrate();
  await initializeBilling(db);
  await boss.start();
  await db.verifyMigrations();
  process.stdout.write('{"event":"migration_complete"}\n');
} catch {
  process.stderr.write('{"event":"migration_failed"}\n');
  process.exitCode = 1;
} finally {
  await boss.stop();
  await db.close();
}

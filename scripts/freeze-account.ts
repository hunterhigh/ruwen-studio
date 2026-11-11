import { Database } from "../packages/db/src/index.ts";
import { freezeForOperations } from "./lib/freeze-account.ts";

let db: Database | undefined;
try {
  if (!process.env.DATABASE_URL || !process.argv[2] || !process.argv[3])
    throw new Error("Missing freeze inputs");
  db = new Database(process.env.DATABASE_URL);
  await freezeForOperations(
    db,
    process.argv[2],
    process.argv[3],
    (process.env.ADMIN_EMAILS ?? "").split(","),
  );
  process.stdout.write('{"event":"account_frozen"}\n');
} catch {
  process.stderr.write('{"event":"account_freeze_failed"}\n');
  process.exitCode = 1;
} finally {
  await db?.close();
}

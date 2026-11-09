import { parseArgs } from "node:util";
import {
  LocalDirFS,
  migrateProjectPrompts,
} from "../packages/core/src/index.ts";
import { Database } from "../packages/db/src/index.ts";

const { values } = parseArgs({ options: { project: { type: "string" } } });
if (!values.project || !process.env.DATABASE_URL)
  throw new Error(
    "Usage: DATABASE_URL=<platform database> node scripts/migrate-private-prompts.ts --project <local project>",
  );
const db = new Database(process.env.DATABASE_URL);
try {
  await db.migrate();
  const result = await migrateProjectPrompts(
    new LocalDirFS(values.project),
    async (hash, content) => {
      await db.pool.query(
        "INSERT INTO prompts(sha256,content) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [hash, content],
      );
    },
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await db.close();
}

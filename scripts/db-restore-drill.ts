import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  backupDatabase,
  databaseFingerprint,
  restoreNewDatabase,
} from "./lib/database-backup.ts";

// Deliberately limited to an operator-selected local TEST database. No .env load or service restart.
let phase = "validate";
try {
  const source = new URL(process.env.DRILL_DATABASE_URL ?? "");
  if (
    !["127.0.0.1", "localhost"].includes(source.hostname) ||
    source.port === "54329" ||
    !/^\/ruwen_test_[a-z0-9_]+$/.test(source.pathname)
  )
    throw new Error("Restore drills require an isolated local test database");
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const target = new URL(source);
  const name = `ruwen_restore_drill_${stamp}`;
  target.pathname = `/${name}`;
  const directory = path.resolve(".local/backups");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  phase = "fingerprint_source";
  const before = await databaseFingerprint(source.toString());
  phase = "backup";
  await backupDatabase(
    source.toString(),
    path.join(directory, `${stamp}.dump`),
  );
  phase = "restore";
  await restoreNewDatabase(
    target.toString(),
    path.join(directory, `${stamp}.dump`),
    name,
  );
  phase = "fingerprint_restored";
  const after = await databaseFingerprint(target.toString());
  phase = "compare";
  assert.deepEqual(after, before);
  const report = {
    event: "restore_drill_passed",
    time: new Date().toISOString(),
    sourcePort: Number(source.port || 5432),
    targetDatabase: name,
    ...after,
  };
  await writeFile(
    path.join(directory, "latest-drill.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch {
  process.stderr.write(
    `${JSON.stringify({ event: "restore_drill_failed", phase })}\n`,
  );
  process.exitCode = 1;
}

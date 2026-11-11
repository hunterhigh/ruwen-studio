import { restoreNewDatabase } from "./lib/database-backup.ts";

try {
  if (!process.env.RESTORE_DATABASE_URL || !process.argv[2])
    throw new Error("Missing restore inputs");
  await restoreNewDatabase(
    process.env.RESTORE_DATABASE_URL,
    process.argv[2],
    process.env.RESTORE_CONFIRM ?? "",
  );
  process.stdout.write('{"event":"restore_complete"}\n');
} catch {
  process.stderr.write('{"event":"restore_failed"}\n');
  process.exitCode = 1;
}

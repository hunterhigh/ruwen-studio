import { backupDatabase } from "./lib/database-backup.ts";

try {
  if (!process.env.DATABASE_URL || !process.argv[2])
    throw new Error("Missing backup inputs");
  await backupDatabase(process.env.DATABASE_URL, process.argv[2]);
  process.stdout.write('{"event":"backup_complete"}\n');
} catch {
  process.stderr.write('{"event":"backup_failed"}\n');
  process.exitCode = 1;
}

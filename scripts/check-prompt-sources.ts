import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import {
  defaultPromptLockPath,
  snapshotPromptSources,
  verifyPromptSources,
} from "../packages/agents/src/security/prompt-sources.ts";

const { values } = parseArgs({
  options: { update: { type: "boolean", default: false } },
});
const lock = values.update
  ? await snapshotPromptSources()
  : await verifyPromptSources();
if (values.update) {
  await writeFile(
    defaultPromptLockPath,
    `${JSON.stringify(lock, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    "Lock updated. Include the upstream prompt diff summary in the commit and obtain human review.\n",
  );
}
process.stdout.write(
  `${JSON.stringify({ status: "verified", upstream_commit: lock.upstream_commit, files: Object.keys(lock.files).length })}\n`,
);

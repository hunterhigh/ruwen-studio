import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  assertModelCredentialFiles,
  createRealRuntime,
} from "../packages/agents/src/index.ts";
import { runP3Ping } from "./lib/p3-ping.ts";

const { values } = parseArgs({
  options: {
    profile: { type: "string", default: "deepseek" },
    output: { type: "string", default: ".local/p3-deepseek/ping" },
  },
});
if (values.profile !== "deepseek")
  throw new Error("p3:ping currently supports --profile deepseek only");
assertModelCredentialFiles();
if (process.env.REAL_MODEL !== "1")
  throw new Error("Human-run ping requires REAL_MODEL=1; incurs provider cost");
process.env.MODEL_PROFILE = values.profile;
const report = await runP3Ping(createRealRuntime());
const output = path.resolve(values.output);
await mkdir(output, { recursive: true });
await writeFile(
  path.join(output, "ping-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
for (const check of report.checks)
  console.log(
    `${check.kind}: ${check.ok ? "OK" : "FAILED"}; ${check.model}; USD ${check.usage.cost.total.toFixed(8)}; ${check.durationMs}ms`,
  );
console.log(`Total USD ${report.costUsd.toFixed(8)}; report: ${output}`);
if (!report.ok) process.exitCode = 1;

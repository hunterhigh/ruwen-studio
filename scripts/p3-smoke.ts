import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { isolatedDatabase } from "./lib/isolated-project.ts";
import { runP3Smoke } from "./lib/p3-smoke.ts";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "faux" },
    "max-usd": { type: "string", default: "5" },
    output: { type: "string" },
    live: { type: "boolean", default: false },
  },
});
if (!["faux", "record", "replay"].includes(values.mode))
  throw new Error("--mode must be faux, record, or replay");
const maxUsd = Number(values["max-usd"]);
if (!Number.isFinite(maxUsd) || maxUsd <= 0)
  throw new Error("--max-usd must be finite and positive");
if (values.live && values.mode === "replay")
  throw new Error("Replay cannot enable a live upstream");
if (values.live) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  if (process.env.REAL_MODEL !== "1")
    throw new Error(
      "Live smoke requires explicit REAL_MODEL=1 and configured provider credentials; this command will incur provider cost",
    );
  if (!process.env.RUWEN_CANARY)
    throw new Error("Live smoke requires the deployment RUWEN_CANARY");
} else process.env.RUWEN_CANARY ??= "RUWEN_TOOL_FAUX_ONLY_P3_SMOKE";
// Product billing stays sandbox-only in the disposable tool DB, including future live transport.
process.env.MODEL_MODE = "faux";
const directory = path.resolve(
  values.output ??
    `.local/p3-smoke/${new Date().toISOString().replaceAll(/[:.]/g, "-")}`,
);
if (values.mode === "replay" && !values.output)
  throw new Error("Replay requires --output pointing to a previous recording");
const database = await isolatedDatabase();
try {
  const report = await runP3Smoke({
    url: database.url,
    directory,
    mode: values.mode === "replay" ? "replay" : "record",
    maxUsd,
    live: values.live,
  });
  console.log(
    `${report.status}: ${report.steps.map((s) => `${s.phase}=${s.status}`).join(" → ")}`,
  );
  console.log(
    `USD ${report.costUsd.toFixed(6)} spent, ${report.heldUsd.toFixed(6)} held / cap ${maxUsd}`,
  );
  console.log(`Report and full candidate: ${directory}`);
  if (report.status !== "completed") process.exitCode = 1;
} finally {
  await database.close();
}

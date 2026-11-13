import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { assertModelCredentialFiles } from "../packages/agents/src/index.ts";
import { modelProfile } from "../packages/agents/src/model-profile.ts";
import { isolatedDatabase } from "./lib/isolated-project.ts";
import { runP3Smoke } from "./lib/p3-smoke.ts";
import { formatSmokePlan, smokePlan } from "./lib/smoke-plan.ts";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "faux" },
    "max-usd": { type: "string", default: "5" },
    output: { type: "string" },
    live: { type: "boolean", default: false },
    plan: { type: "boolean", default: false },
    profile: { type: "string" },
    "brief-file": { type: "string" },
    "continue-on-verdict": { type: "boolean", default: false },
  },
});
if (values.profile) process.env.MODEL_PROFILE = values.profile;
modelProfile();
if (!["faux", "record", "replay"].includes(values.mode))
  throw new Error("--mode must be faux, record, or replay");
const maxUsd = Number(values["max-usd"]);
const brief = values["brief-file"]
  ? new TextDecoder("utf-8", { fatal: true })
      .decode(await readFile(path.resolve(values["brief-file"])))
      .replace(/^\uFEFF/, "")
  : undefined;
if (!Number.isFinite(maxUsd) || maxUsd <= 0)
  throw new Error("--max-usd must be finite and positive");
if (values.plan && (values.live || values.mode === "replay"))
  throw new Error("--plan cannot use --live or --mode replay");
if (values.live && values.mode === "replay")
  throw new Error("Replay cannot enable a live upstream");
if (values.live) {
  assertModelCredentialFiles();
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
if (
  !values.plan &&
  values.mode !== "replay" &&
  existsSync(path.join(directory, "smoke-plan.json"))
)
  throw new Error(
    "Recording already exists. Choose a NEW --output directory (for example .local/p3-deepseek/smoke-02); existing evidence is preserved and no model request was sent.",
  );
const database = await isolatedDatabase();
try {
  const report = await runP3Smoke({
    url: database.url,
    directory,
    mode: values.mode === "replay" ? "replay" : "record",
    maxUsd,
    live: values.live,
    planOnly: values.plan,
    continueOnVerdict: values["continue-on-verdict"],
    ...(brief !== undefined ? { brief } : {}),
  });
  if (values.plan) {
    console.log(formatSmokePlan(smokePlan(report)));
    if (report.status !== "completed") process.exitCode = 1;
  } else {
    if (report.warning) console.log(`⚠ ${report.warning}`);
    console.log(
      `${report.stop?.label ?? report.status}: ${report.steps.map((s) => `${s.phase}=${s.status}`).join(" → ")}`,
    );
    console.log(
      `USD ${report.costUsd.toFixed(6)} spent, ${report.heldUsd.toFixed(6)} held / cap ${maxUsd}`,
    );
    console.log(`Report and full candidate: ${directory}`);
    if (report.status === "failed") process.exitCode = 1;
  }
} finally {
  await database.close();
}

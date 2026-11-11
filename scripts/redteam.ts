import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { isolatedDatabase } from "./lib/isolated-project.ts";
import { type RiskResult, runProductRiskCase } from "./lib/product-risk.ts";
import { PRODUCT_RISK_CASES } from "./lib/product-risk-cases.ts";

const { values } = parseArgs({
  options: {
    mode: { type: "string", default: "faux" },
    output: { type: "string", default: ".local/redteam" },
  },
});
if (!["faux", "record", "replay"].includes(values.mode))
  throw new Error(
    "--mode must be faux, record (faux upstream), or replay; real models are not enabled by this tool",
  );
const mode = values.mode === "replay" ? "replay" : "record",
  directory = path.resolve(values.output);
// A fixed marker is permitted only for this faux-only tool. Never read or configure a real provider key.
process.env.RUWEN_CANARY ??= "RUWEN_TOOL_FAUX_ONLY_REDTEAM";
await mkdir(directory, { recursive: true });
const manifest = path.join(directory, "corpus.json");
if (mode === "record")
  await writeFile(manifest, JSON.stringify(PRODUCT_RISK_CASES, null, 2));
else if (
  (await readFile(manifest, "utf8")) !==
  JSON.stringify(PRODUCT_RISK_CASES, null, 2)
)
  throw new Error("Replay corpus differs; record the reviewed corpus first");
const database = await isolatedDatabase();
const rows: RiskResult[] = [];
try {
  for (const test of PRODUCT_RISK_CASES) {
    const row = await runProductRiskCase(
      database.url,
      test,
      mode,
      path.join(directory, test.id),
    );
    rows.push(row);
    console.log(`${row.passed ? "PASS" : "FAIL"} ${row.id} ${row.boundary}`);
  }
} finally {
  await database.close();
  const passed = rows.filter((r) => r.passed).length,
    normal = rows.filter((r) => r.group === "normal");
  const summary = {
    mode: values.mode,
    upstream: "faux-only",
    cases: rows.length,
    expectedCases: 40,
    passed,
    failed: rows.length - passed,
    normalFictionFalseRefusals: normal.filter((r) => !r.passed).length,
    realModelValidated: false,
    rows,
  };
  await writeFile(
    path.join(directory, `report-${values.mode}.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(`Report: ${path.join(directory, `report-${values.mode}.json`)}`);
  if (rows.length !== 40 || passed !== 40) process.exitCode = 1;
}

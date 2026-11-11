import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, inject, it } from "vitest";
import { runProductRiskCase } from "../../../scripts/lib/product-risk.ts";
import { PRODUCT_RISK_CASES } from "../../../scripts/lib/product-risk-cases.ts";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "ruwen-risk-tapes-"));
  expect(PRODUCT_RISK_CASES).toHaveLength(40);
  expect(new Set(PRODUCT_RISK_CASES.map((c) => c.id)).size).toBe(40);
});
afterAll(async () => {
  if (
    directory &&
    path.dirname(directory) === path.resolve(tmpdir()) &&
    path.basename(directory).startsWith("ruwen-risk-tapes-")
  )
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
});
it.each(
  PRODUCT_RISK_CASES,
)("$id exercises $group boundaries with faux recording and offline replay", async (test) => {
  const root = path.join(directory, test.id);
  const record = await runProductRiskCase(
    inject("databaseUrl"),
    test,
    "record",
    root,
  );
  expect(record.passed, JSON.stringify(record)).toBe(true);
  const replay = await runProductRiskCase(
    inject("databaseUrl"),
    test,
    "replay",
    root,
  );
  expect(replay.passed, JSON.stringify(replay)).toBe(true);
  expect(replay.boundary).toBe(record.boundary);
  expect(replay.providerCalls).toBe(0);
  expect(replay.costUsd).toBe(record.costUsd);
}, 30000);

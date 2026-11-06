import { afterEach, beforeEach, expect, it } from "vitest";
import { validateHandoff } from "../src/handoff/index.ts";
import { validateAudit } from "../src/ledgers/index.ts";
import { validateRegistry } from "../src/registry/index.ts";
import { type ObjectData, readJson, writeJson } from "../src/runtime.ts";
import { temporaryProject } from "./helpers.ts";

let project: Awaited<ReturnType<typeof temporaryProject>>;
beforeEach(async () => {
  project = await temporaryProject();
});
afterEach(async () => {
  await project.cleanup();
});
it("rejects enum arrays and inherited object property names without throwing", async () => {
  const fs = project.fs;
  for (const value of ["__proto__", "toString", ["world"]]) {
    const data = await readJson(fs, "治理/资源注册表.json");
    const item = (data.resources as ObjectData[])[1];
    if (!item) throw new Error("fixture");
    item.type = value;
    await writeJson(fs, "治理/资源注册表.json", data);
    expect(
      (await validateRegistry(fs)).errors.some((e) => e.includes("type无效")),
    ).toBe(true);
  }
  for (const kind of ["__proto__", "toString", ["creative_brief"]])
    expect(
      await validateHandoff({
        kind,
        sender: "role",
        recipient: "gushi-gousishi",
        resource_ids: [],
        scope: { project: "test-project" },
        approval_ref: null,
        payload: {},
      }),
    ).toContain("未知交接物类型");
  expect(
    validateAudit({
      role: "role",
      resource_ids: [],
      change: "technical_change",
      scope: {
        project: "test-project",
        volume: null,
        arc: null,
        chapter: null,
      },
      conflict_category: null,
      approval_status: ["approved"],
      result: "result_ok",
    }),
  ).toContain("approval_status无效");
});

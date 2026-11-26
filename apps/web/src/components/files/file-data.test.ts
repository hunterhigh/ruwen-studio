import { registry } from "@ruwen/core";
import { describe, expect, it } from "vitest";
import { filesCopy } from "../../copy/zh-CN.ts";
import {
  fileKeyValues,
  parseLedger,
  parseRegistry,
  statusLabel,
} from "./file-data.ts";

describe("project file presentation", () => {
  it("maps every registry transition and treats malformed registration data as unavailable", () => {
    expect(Object.keys(filesCopy.status).sort()).toEqual(
      Object.keys(registry.TRANSITIONS).sort(),
    );
    expect(statusLabel("toString")).toBe(filesCopy.unknownStatus);
    expect(parseRegistry('{"resources":{}}')).toBeUndefined();
    const row = {
      path: "人物/主角档案.md",
      id: "protagonist",
      status: "active",
    };
    expect(
      parseRegistry(JSON.stringify({ resources: [row, row] })),
    ).toBeUndefined();
    expect(
      parseRegistry(JSON.stringify({ resources: [row] }))?.get(row.path),
    ).toEqual(row);
  });

  it("orders ledger rows by actual time, then reverse append order for untimed records", () => {
    const { entries, unreadable } = parseLedger(
      [
        '{"time":"2026-11-06T07:10:01+01:00","title":"earlier"}',
        '{"title":"older entry without a timestamp"}',
        "",
        '{"time":"2026-11-06T07:07:00Z","title":"later"}',
        "not a JSON line",
        '{"time":"12","title":"untimed"}',
      ].join("\n"),
    );
    expect(unreadable).toBe(1);
    expect(entries.map(({ entry }) => entry.title)).toEqual([
      "later",
      "earlier",
      "untimed",
      "older entry without a timestamp",
    ]);
    expect(entries[2]?.timestamp).toBeUndefined();
  });

  it("adapts structured labels and drops private artifact fields recursively", () => {
    expect(
      fileKeyValues({
        status: "candidate",
        model: "private-model",
        failures: [
          { attempt: 1, error: "Read failure", prompt_sha256: "secret" },
        ],
      }),
    ).toEqual([
      { name: "状态", content: "候选" },
      {
        name: "尝试记录",
        content: [
          [
            { name: "尝试次数", content: 1 },
            { name: "错误说明", content: "Read failure" },
          ],
        ],
      },
    ]);
  });
});

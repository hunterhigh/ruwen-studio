import type { RunStatus } from "@ruwen/pipeline";
import { describe, expect, it } from "vitest";
import { completedRoleCount } from "./review-data.ts";

const expected: Record<RunStatus, number> = {
  REQUESTED: 0,
  READINESS_OK: 0,
  PACKET_COMPILED: 0,
  AUTHOR_DONE: 1,
  READER_DONE: 2,
  EDITOR_DONE: 3,
  PLOT_CHECKED: 4,
  REALITY_CHECKED: 5,
  AWAITING_CANDIDATE_APPROVAL: 5,
  CANDIDATE_APPROVED: 5,
  MEMORY_PREVIEW_READY: 6,
  AWAITING_MEMORY_APPROVAL: 6,
  MEMORY_COMMITTED: 6,
  DONE: 6,
  RETURNED: 0,
  FAILED_PRECONDITION: 0,
  FAILED: 0,
  CANCELLED: 0,
};

describe("role completion from run checkpoints", () => {
  it.each(
    Object.entries(expected) as [RunStatus, number][],
  )("%s proves %i completed roles without a role row or event history", (status, count) =>
    expect(completedRoleCount(status)).toBe(count));

  it("uses the last proven checkpoint after return, failure, or cancellation", () => {
    expect(completedRoleCount("RETURNED", [{ status: "EDITOR_DONE" }])).toBe(3);
    expect(completedRoleCount("FAILED", [{ status: "PLOT_CHECKED" }])).toBe(4);
    expect(
      completedRoleCount("CANCELLED", [
        { status: "CANDIDATE_APPROVED" },
        { status: "AWAITING_MEMORY_APPROVAL" },
        { status: "CANCELLED" },
      ]),
    ).toBe(6);
  });
});

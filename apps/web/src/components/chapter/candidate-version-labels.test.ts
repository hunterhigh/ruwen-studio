import { describe, expect, it } from "vitest";
import {
  candidateVersionLabels,
  verificationBasisVersion,
} from "./candidate-version-labels.ts";

describe("candidate version labels", () => {
  it("shows one user sequence across manual, undo and restore versions", () => {
    const labels = candidateVersionLabels([
      { version: 5, source: "user", op: "revert_editor_edits" },
      { version: 1, source: "author", op: null },
      { version: 2, source: "editor", op: null },
      { version: 3, source: "user", op: "manual" },
      { version: 4, source: "user", op: "manual" },
      { version: 6, source: "user", op: "reapply_editor_edits" },
    ]);
    expect([...labels]).toEqual([
      [1, "作者原稿"],
      [2, "编辑稿"],
      [3, "你的第 1 版"],
      [4, "你的第 2 版"],
      [5, "你的第 3 版"],
      [6, "你的第 4 版"],
    ]);
  });

  it("locates author and editor bases and uses the recorded reverification version when hashes repeat", () => {
    const versions = [
      { version: 1, source: "author", sha256: "author" },
      { version: 2, source: "editor", sha256: "editor" },
      { version: 3, source: "user", sha256: "editor" },
    ] as const;
    expect(
      verificationBasisVersion({ verificationBasisSha256: "author" }, versions),
    ).toBe(1);
    expect(
      verificationBasisVersion({ verificationBasisSha256: "editor" }, versions),
    ).toBe(2);
    expect(
      verificationBasisVersion(
        {
          verificationBasisSha256: "editor",
          verificationRunId: "check",
          reverification: {
            id: "check",
            version: 3,
            sha256: "editor",
            status: "passed",
          },
        },
        versions,
      ),
    ).toBe(3);
    expect(
      verificationBasisVersion(
        { verificationBasisSha256: "editor", verificationRunId: "unknown" },
        versions,
      ),
    ).toBeUndefined();
  });
});

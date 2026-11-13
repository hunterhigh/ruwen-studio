import { randomUUID } from "node:crypto";
import { ledgers } from "@ruwen/core";
import type { ChapterRun } from "@ruwen/pipeline";
import { expect, it } from "vitest";
import {
  type SmokeVerdictReview,
  smokeVerdictReviewer,
} from "../../../scripts/lib/smoke-verdict-review.ts";
import { fixture } from "./helpers.ts";

it("records one hash-bound test-user decision and audit atomically across concurrent replays, refusing stale candidate or verdict", async () => {
  const { service, fs } = await fixture();
  try {
    const candidate = "authoring-ruwen-v5/candidates/test-smoke-candidate.md";
    await fs.write(candidate, "仅供工具测试的候选稿。");
    const run: ChapterRun = {
      id: randomUUID(),
      projectKey: "demo-ruwen",
      chapter: "001",
      target: "chapters/001.md",
      status: "REALITY_CHECKED",
      paths: { candidate },
      roles: {},
      costTotal: 0,
      events: [],
    };
    const verdict = { pass: false, issues: [{ evidence: "原始核验意见。" }] };
    const reviews: SmokeVerdictReview[] = [],
      review = smokeVerdictReviewer(reviews);
    const count = async () =>
      (await ledgers.readEntries(fs, "治理/审计账本.jsonl")).filter(
        (entry) => entry.change === "human_rejects_verdict",
      );
    const before = (await count()).length;
    await Promise.all([
      review(fs, "xianshi-heyanyuan", verdict, run),
      review(fs, "xianshi-heyanyuan", verdict, run),
    ]);
    expect(reviews).toHaveLength(1);
    expect(await count()).toHaveLength(before + 1);
    expect(reviews[0]?.candidateSha256).toBe(await fs.sha256(candidate));
    await expect(
      review(
        fs,
        "xianshi-heyanyuan",
        { ...verdict, issues: [{ evidence: "被改过的意见。" }] },
        run,
      ),
    ).rejects.toThrow("stale");
    await fs.write(candidate, "候选稿已经变化。");
    await expect(review(fs, "xianshi-heyanyuan", verdict, run)).rejects.toThrow(
      "stale",
    );
    expect(await count()).toHaveLength(before + 1);
    expect(await fs.exists(run.target)).toBe(false);
  } finally {
    await service.stop();
  }
});

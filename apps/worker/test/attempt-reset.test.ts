import { createFauxRuntime, FAUX_PROSE } from "@ruwen/agents";
import { afterEach, expect, it, vi } from "vitest";
import { defaultFauxResponse } from "../../../packages/agents/src/faux.ts";
import { streamSink } from "../src/stream-events.ts";
import { fixture } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

it("worker persists a reset barrier in the same cursor order as safe author deltas", async () => {
  const invalid = `${"雨水沿着屋檐落下。".repeat(12)}\n# 自检\n本章逐项落实了大纲要求。`;
  const { fs, service } = await fixture({
    runtime: () =>
      createFauxRuntime([
        (context) => ({
          ...defaultFauxResponse(context),
          content: [{ type: "text", text: invalid }],
          stopReason: "stop",
        }),
        ...Array.from({ length: 20 }, () => defaultFauxResponse),
      ]),
  });
  cleanup.push(() => service.stop());
  const id = await service.enqueueChapter(fs, { chapter: 1 });
  expect(
    (
      await service.handle({
        kind: "chapter",
        projectId: fs.projectId,
        ownerId: fs.ownerId,
        runId: id,
      })
    )?.status,
  ).toBe("AWAITING_CANDIDATE_APPROVAL");
  const { rows } = await service.db.pool.query<{
    id: string;
    event_type: string;
    delta: string;
    reset_reason: string | null;
  }>(
    "SELECT id,event_type,delta,reset_reason FROM web_run_events WHERE run_id=$1 AND role_id='xiaoshuo-zuozhe' ORDER BY id",
    [id],
  );
  const reset = rows.findIndex((row) => row.event_type === "reset");
  expect(reset).toBeGreaterThan(0);
  expect(rows[reset]?.reset_reason).toBe("format_correction");
  expect(rows[reset]?.delta).toBe("");
  expect(rows.filter((row) => row.event_type === "reset")).toHaveLength(1);
  expect(rows.slice(0, reset).every((row) => row.event_type === "delta")).toBe(
    true,
  );
  expect(rows.slice(reset + 1).every((row) => row.event_type === "delta")).toBe(
    true,
  );
  expect(
    rows
      .slice(reset + 1)
      .map((row) => row.delta)
      .join(""),
  ).toBe(FAUX_PROSE);
  expect(
    rows.every((row, i) => i === 0 || Number(row.id) > Number(rows[i - 1]?.id)),
  ).toBe(true);
});

it("failed reset persistence never lets subsequent deltas overtake or silently omit its barrier", async () => {
  const { fs, service } = await fixture();
  cleanup.push(() => service.stop());
  const id = await service.enqueueChapter(fs, { chapter: 1 });
  const original = service.db.pool.query.bind(service.db.pool);
  const query = vi
    .spyOn(service.db.pool, "query")
    .mockImplementation((...args: unknown[]) => {
      if (
        typeof args[0] === "string" &&
        args[0].startsWith("INSERT INTO web_run_events") &&
        Array.isArray(args[1]) &&
        args[1][4] === "reset"
      )
        return Promise.reject(new Error("test reset storage failure"));
      return Reflect.apply(original, service.db.pool, args);
    });
  const onError = vi.fn();
  const sink = streamSink(service.db, fs.projectId, id, onError);
  try {
    sink.push("before", "xiaoshuo-zuozhe");
    sink.reset("xiaoshuo-zuozhe", "format_correction");
    sink.push("after", "xiaoshuo-zuozhe");
    await expect(sink.finish()).rejects.toThrow("test reset storage failure");
  } finally {
    query.mockRestore();
  }
  const rows = await service.db.pool.query(
    "SELECT delta FROM web_run_events WHERE run_id=$1 ORDER BY id",
    [id],
  );
  expect(rows.rows.map((row) => row.delta)).toEqual(["before"]);
  expect(onError).toHaveBeenCalledTimes(1);
});

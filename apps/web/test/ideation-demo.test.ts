import type { IdeationPreview, IdeationResult } from "@ruwen/pipeline";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createIdeationDemo,
  newRequestId,
} from "../src/components/ideation/demo.ts";

const timing = { resetMs: 10, responseMs: 20, chunkMs: 1 };
const demos: ReturnType<typeof createIdeationDemo>[] = [];
function fixture() {
  const demo = createIdeationDemo(
    "11111111-1111-4111-8111-111111111111",
    timing,
    8000,
  );
  demos.push(demo);
  return demo;
}
function value<T>(result: IdeationResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
async function preview(
  demo: ReturnType<typeof fixture>,
  kind: IdeationPreview["kind"],
) {
  const result = value(
    await demo.api.listPreviews({ sessionId: demo.initialSessionId }),
  ).items.find((item) => item.kind === kind);
  if (!result) throw new Error("Missing fixture preview");
  return result;
}
const approval = (preview: IdeationPreview) => ({
  previewId: preview.id,
  expectedSha256: preview.sha256,
  confirmed: true as const,
  clientRequestId: newRequestId(),
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const demo of demos.splice(0)) demo.dispose();
  vi.useRealTimers();
});
it("v1.1 session listing filters and paginates by immutable creation order; close is idempotent", async () => {
  const demo = fixture();
  const first = value(await demo.api.listIdeationSessions({ limit: 1 }));
  expect(first.items.map((item) => item.id)).toEqual([demo.initialSessionId]);
  if (!first.nextCursor) throw new Error("Missing cursor");
  const next = value(
    await demo.api.listIdeationSessions({ after: first.nextCursor, limit: 1 }),
  );
  expect(next.items).toHaveLength(1);
  expect(next.items[0]?.id).not.toBe(demo.initialSessionId);
  const request = {
    sessionId: demo.initialSessionId,
    clientRequestId: newRequestId(),
  };
  const closed = value(await demo.api.closeIdeationSession(request));
  expect(value(await demo.api.closeIdeationSession(request))).toEqual(closed);
  expect(
    value(
      await demo.api.closeIdeationSession({
        ...request,
        clientRequestId: newRequestId(),
      }),
    ),
  ).toEqual(closed);
  expect(
    value(await demo.api.listIdeationSessions({ status: "closed" })).items.map(
      (item) => item.id,
    ),
  ).toEqual([closed.id]);
  expect(
    value(await demo.api.listIdeationSessions({ status: "open" })).items,
  ).toHaveLength(1);
  expect(await demo.api.listIdeationSessions({ limit: 101 })).toMatchObject({
    ok: false,
    error: { code: "INVALID_ARGUMENT" },
  });
});

it("v1.1 close stops only new coordinator input; accepted turns finish and existing previews remain decidable", async () => {
  const demo = fixture(),
    sessionId = demo.initialSessionId;
  const original = await preview(demo, "file_patch");
  value(
    await demo.api.sendIdeationMessage({
      sessionId,
      expectedSessionRevision: 0,
      content: "保留人物的选择。",
      clientRequestId: newRequestId(),
    }),
  );
  value(
    await demo.api.closeIdeationSession({
      sessionId,
      clientRequestId: newRequestId(),
    }),
  );
  expect(value(await demo.api.getPreview({ previewId: original.id }))).toEqual(
    original,
  );
  expect(
    await demo.api.revisePreview({
      previewId: original.id,
      expectedSha256: original.sha256,
      content: "想改一处",
      clientRequestId: newRequestId(),
    }),
  ).toMatchObject({ ok: false, error: { code: "SESSION_CLOSED" } });
  await vi.runAllTimersAsync();
  expect(value(await demo.api.getIdeationSession({ sessionId }))).toMatchObject(
    { status: "closed", currentTurnId: null },
  );
  expect(
    value(await demo.api.listIdeationMessages({ sessionId })).items.filter(
      (item) => item.role === "assistant",
    ),
  ).toHaveLength(2);
  expect(
    value(await demo.api.approvePreview(approval(original))).previewId,
  ).toBe(original.id);
  const handoff = await preview(demo, "handoff");
  value(
    await demo.api.rejectPreview({ ...approval(handoff), reason: "暂时放下" }),
  );
  expect(
    value(await demo.api.getPreview({ previewId: handoff.id })).status,
  ).toBe("rejected");
});

it.each([
  "handoff",
  "learning_plan",
] as const)("%s approval starts a separate task whose output still awaits approval", async (kind) => {
  const demo = fixture(),
    source = await preview(demo, kind);
  const receipt = value(await demo.api.approvePreview(approval(source)));
  if (!receipt.startedTaskId) throw new Error("Missing task");
  expect(
    value(await demo.api.getIdeationTask({ taskId: receipt.startedTaskId }))
      .status,
  ).toBe("QUEUED");
  await vi.runAllTimersAsync();
  const task = value(
    await demo.api.getIdeationTask({ taskId: receipt.startedTaskId }),
  );
  expect(task.status).toBe("AWAITING_PREVIEW_APPROVAL");
  for (const id of task.outputPreviewIds)
    expect(value(await demo.api.getPreview({ previewId: id })).status).toBe(
      "pending",
    );
  expect(receipt.committedFiles).toEqual([]);
});

it("file preview has exact before/after and new-file views; repeated decisions do not produce a second receipt", async () => {
  const demo = fixture(),
    source = await preview(demo, "file_patch");
  if (source.kind !== "file_patch") throw new Error("Wrong fixture");
  expect(source.patches.map((patch) => patch.kind)).toEqual([
    "sections",
    "create",
  ]);
  const request = approval(source),
    receipt = value(await demo.api.approvePreview(request));
  expect(receipt.committedFiles).toHaveLength(2);
  expect(value(await demo.api.approvePreview(request))).toEqual(receipt);
  expect(await demo.api.approvePreview(approval(source))).toMatchObject({
    ok: false,
    error: { code: "ALREADY_DECIDED" },
  });
  expect(
    await demo.api.approvePreview({ ...request, confirmed: false as true }),
  ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
});

it("candidate approval cannot activate expression; the independent activation preview requires explicit trial reading", async () => {
  const demo = fixture(),
    source = await preview(demo, "expression_candidate");
  value(await demo.api.approvePreview(approval(source)));
  const activation = value(
    await demo.api.listPreviews({ sessionId: source.sessionId }),
  ).items.find(
    (item) =>
      item.kind === "expression_candidate" &&
      item.approvalStage === "activation",
  );
  if (activation?.kind !== "expression_candidate")
    throw new Error("Missing activation");
  expect(activation.status).toBe("pending");
  expect(activation.id).not.toBe(source.id);
  expect(activation.resource.status).toBe("candidate");
  expect(await demo.api.approvePreview(approval(activation))).toMatchObject({
    ok: false,
    error: { code: "NONCANONICAL_TRIAL_REQUIRED" },
  });
  const request = {
    ...approval(activation),
    resourceId: activation.resource.id,
    expectedResourceSha256: activation.resource.sha256,
    trialReadConfirmed: true as const,
  };
  expect(
    await demo.api.activateExpression({
      ...request,
      trialReadConfirmed: false as true,
    }),
  ).toMatchObject({ ok: false, error: { code: "APPROVAL_REQUIRED" } });
  expect(
    value(
      await demo.api.activateExpression({
        ...request,
        clientRequestId: newRequestId(),
      }),
    ).previewId,
  ).toBe(activation.id);
});

it("revisions preserve raw wording only in coordinator messages and create an unapproved new immutable version", async () => {
  const demo = fixture(),
    source = await preview(demo, "handoff");
  const raw =
    "RAW_COORDINATOR_ONLY_8ea9\n<script>不可执行</script>\n![不可外发](https://tracker.invalid/data)";
  value(
    await demo.api.revisePreview({
      previewId: source.id,
      expectedSha256: source.sha256,
      clientRequestId: newRequestId(),
      content: raw,
    }),
  );
  expect(
    value(await demo.api.getPreview({ previewId: source.id })).status,
  ).toBe("superseded");
  await vi.runAllTimersAsync();
  const previews = value(
    await demo.api.listPreviews({ sessionId: source.sessionId }),
  ).items;
  const next = previews.find((item) => item.supersedesPreviewId === source.id);
  expect(next).toMatchObject({ revision: 2, status: "pending" });
  expect(next?.sha256).not.toBe(source.sha256);
  expect(
    value(
      await demo.api.listIdeationMessages({ sessionId: source.sessionId }),
    ).items.some((item) => item.content === raw),
  ).toBe(true);
  const tasks = value(
    await demo.api.listIdeationTasks({ sessionId: source.sessionId }),
  );
  const events = value(
    await demo.api.listIdeationEvents({ sessionId: source.sessionId }),
  );
  expect(JSON.stringify([previews, tasks, events])).not.toContain(
    "RAW_COORDINATOR_ONLY_8ea9",
  );
});

it("rejection keeps its reason in the coordinator; session close remains read-only and does not delete history", async () => {
  const demo = fixture(),
    source = await preview(demo, "generation_field");
  const reason = "PRIVATE_REJECTION_REASON_793c";
  value(await demo.api.rejectPreview({ ...approval(source), reason }));
  expect(
    value(await demo.api.getPreview({ previewId: source.id })).status,
  ).toBe("rejected");
  value(
    await demo.api.closeIdeationSession({
      sessionId: source.sessionId,
      clientRequestId: newRequestId(),
    }),
  );
  expect(
    await demo.api.sendIdeationMessage({
      sessionId: source.sessionId,
      expectedSessionRevision: 0,
      content: "继续",
      clientRequestId: newRequestId(),
    }),
  ).toMatchObject({ ok: false, error: { code: "SESSION_CLOSED" } });
  expect(
    value(
      await demo.api.listIdeationMessages({ sessionId: source.sessionId }),
    ).items.some((item) => item.content === reason),
  ).toBe(true);
  expect(
    JSON.stringify(
      value(await demo.api.listIdeationEvents({ sessionId: source.sessionId })),
    ),
  ).not.toContain(reason);
});

it("generation approval is independent; a queued compilation cancelled before its first timer stays cancelled", async () => {
  const demo = fixture(),
    source = await preview(demo, "generation_field");
  const receipt = value(await demo.api.approvePreview(approval(source)));
  expect(receipt.projectionRegistered).toBe(true);
  const job = value(
    await demo.api.requestIdeationCompilation({
      sessionId: source.sessionId,
      chapter: "3",
      scope: { volume: null, arc: null, scene_type: null, pov: null },
      sources: [],
      clientRequestId: newRequestId(),
    }),
  );
  const cancelled = value(
    await demo.api.cancelIdeationTask({
      taskId: job.id,
      clientRequestId: newRequestId(),
    }),
  );
  await vi.runAllTimersAsync();
  expect(
    value(await demo.api.getIdeationTask({ taskId: job.id })),
  ).toMatchObject({
    status: "CANCELLED",
    usage: cancelled.usage,
    outputPreviewIds: [],
  });
  const interrupted = value(
    await demo.api.listIdeationTasks({ sessionId: source.sessionId }),
  ).items.find((item) => item.status === "INTERRUPTED");
  expect(interrupted?.usage.costUsd).toBeNull();
});

it("conversation turn guards reject overlap and over-limit input without implicit retries", async () => {
  const demo = fixture(),
    sessionId = demo.initialSessionId;
  expect(
    await demo.api.sendIdeationMessage({
      sessionId,
      expectedSessionRevision: 0,
      content: "字".repeat(8001),
      clientRequestId: newRequestId(),
    }),
  ).toMatchObject({ ok: false, error: { code: "INPUT_LIMIT_EXCEEDED" } });
  value(
    await demo.api.sendIdeationMessage({
      sessionId,
      expectedSessionRevision: 0,
      content: "保留人物自己决定的空间。",
      clientRequestId: newRequestId(),
    }),
  );
  expect(
    await demo.api.sendIdeationMessage({
      sessionId,
      expectedSessionRevision: 1,
      content: "再发一条",
      clientRequestId: newRequestId(),
    }),
  ).toMatchObject({ ok: false, error: { code: "TURN_IN_PROGRESS" } });
  await vi.runAllTimersAsync();
  expect(
    value(await demo.api.getIdeationSession({ sessionId })).currentTurnId,
  ).toBeNull();
});

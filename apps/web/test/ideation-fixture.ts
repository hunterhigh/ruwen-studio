import { randomUUID } from "node:crypto";
import type { IdeationActor, IdeationResult } from "@ruwen/pipeline";
import { createIdeationService, type WorkerService } from "worker";
export const ideationValue = <T>(result: IdeationResult<T>) => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
/** Real service records and an actual faux coordinator/approval; no fabricated cross-resource IDs. */
export async function ideationFixture(
  worker: WorkerService,
  projectId: string,
  userId: string,
) {
  const service = createIdeationService(worker.db, {
    queue: worker.queue,
    modelMode: worker.modelMode,
  });
  const actor = { projectId, userId } as IdeationActor;
  const session = ideationValue(
    await service.createIdeationSession(actor, {
      clientRequestId: randomUUID() as never,
      title: "HTTP边界会话",
    }),
  );
  const accepted = ideationValue(
    await service.sendIdeationMessage(actor, {
      sessionId: session.id,
      expectedSessionRevision: 0,
      clientRequestId: randomUUID() as never,
      content: "HTTP用户原话甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥",
    }),
  );
  await worker.handle({
    kind: "ideation",
    projectId,
    ownerId: userId,
    runId: accepted.turnId,
  });
  const preview = ideationValue(
    await service.listPreviews(actor, { sessionId: session.id }),
  ).items[0];
  if (!preview) throw new Error("Missing real handoff fixture");
  const decision = ideationValue(
    await service.approvePreview(actor, {
      previewId: preview.id,
      confirmed: true,
      expectedSha256: preview.sha256,
      clientRequestId: randomUUID() as never,
    }),
  );
  return {
    service,
    actor,
    session,
    preview,
    decision,
    accepted,
    ids: {
      sessionId: session.id,
      previewId: preview.id,
      taskId: accepted.turnId,
      decisionId: decision.id,
      messageId: accepted.messageId,
    },
  };
}

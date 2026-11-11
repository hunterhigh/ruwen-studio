import { createFauxRuntime } from "@ruwen/agents";
import { type Task, WorkerService } from "../src/service.ts";

const service = new WorkerService(String(process.env.RUWEN_CHILD_DB), {
  runtime: createFauxRuntime,
  queue: String(process.env.RUWEN_CHILD_QUEUE),
  onBoundary: async (kind) => {
    if (kind === process.env.RUWEN_IDEATION_FAULT) {
      process.send?.({ type: "fault" });
      await new Promise<void>(() => {});
    }
  },
});
try {
  await service.start(false);
  await service.handle(
    JSON.parse(String(process.env.RUWEN_CHILD_TASK)) as Task,
  );
  await service.stop();
  process.send?.({ type: "done" });
} catch {
  process.send?.({ type: "failed" });
  process.exitCode = 1;
  await service.stop().catch(() => {});
}

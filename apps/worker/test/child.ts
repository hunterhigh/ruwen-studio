import { createFauxRuntime } from "@ruwen/agents";
import { type Task, WorkerService } from "../src/service.ts";

const url = process.env.RUWEN_CHILD_DB,
  queue = process.env.RUWEN_CHILD_QUEUE;
if (!url || !queue) throw new Error("Missing child database config");
let triggered = false;
const worker = new WorkerService(url, {
  runtime: createFauxRuntime,
  queue,
  heartbeatSeconds: 10,
  onBoundary: async (kind, name, runId) => {
    if (
      !triggered &&
      kind === process.env.RUWEN_FAULT_KIND &&
      name === process.env.RUWEN_FAULT_NAME
    ) {
      triggered = true;
      process.send?.({ type: "fault", kind, name, runId });
      await new Promise(() => {});
    }
  },
  onError: (error) =>
    process.send?.({ type: "worker-error", message: error.message }),
});
let stopping = false;
process.on("message", async (message) => {
  if (message === "stop" && !stopping) {
    stopping = true;
    await worker.stop();
    process.exit(0);
  }
});
try {
  const task = process.env.RUWEN_CHILD_TASK;
  await worker.start(!task);
  process.send?.({ type: "ready" });
  if (task) {
    const result = await worker.handle(JSON.parse(task) as Task);
    process.send?.({ type: "completed", status: result?.status });
  }
} catch (error) {
  process.send?.({ type: "failed", message: (error as Error).message });
  process.exitCode = 1;
  process.disconnect?.();
}

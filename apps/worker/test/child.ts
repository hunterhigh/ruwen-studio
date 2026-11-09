import { createFauxRuntime } from "@ruwen/agents";
import { defaultFauxResponse } from "../../../packages/agents/src/faux.ts";
import { type Task, WorkerService } from "../src/service.ts";

const url = process.env.RUWEN_CHILD_DB,
  queue = process.env.RUWEN_CHILD_QUEUE;
if (!url || !queue) throw new Error("Missing child database config");
let triggered = false;
const worker = new WorkerService(url, {
  runtime: () =>
    process.env.RUWEN_FAUX_EDITOR_PROBLEM === "1"
      ? createFauxRuntime(
          Array.from({ length: 100 }, () => (context) => {
            const response = defaultFauxResponse(context);
            for (const block of response.content)
              if (block.type === "toolCall" && block.name === "submit_edit")
                block.arguments.problems = [
                  {
                    location: "粮车先出了驿门",
                    category: "explanation",
                    condition: "条件",
                    handling: "处理",
                    result: "结果",
                  },
                ];
            return response;
          }),
        )
      : createFauxRuntime(),
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

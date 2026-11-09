import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createFauxRuntime,
  createRealRuntime,
  DEFAULT_ROLE_TIMEOUT_MS,
} from "@ruwen/agents";
import { WorkerService } from "./service.ts";

const env = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(env)) process.loadEnvFile(env);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!["faux", "real"].includes(process.env.MODEL_MODE ?? ""))
  throw new Error("MODEL_MODE must explicitly be faux or real");
const worker = new WorkerService(process.env.DATABASE_URL, {
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
  roleTimeoutMs: Number(process.env.ROLE_TIMEOUT_MS ?? DEFAULT_ROLE_TIMEOUT_MS),
  queueMarginSeconds: Number(process.env.QUEUE_MARGIN_SECONDS ?? 120),
  runtime: () =>
    process.env.MODEL_MODE === "faux"
      ? createFauxRuntime()
      : createRealRuntime(),
  onError: (error) =>
    console.error(JSON.stringify({ event: "worker_error", name: error.name })),
});
await worker.start();
console.log(
  JSON.stringify({ event: "worker_ready", mode: process.env.MODEL_MODE }),
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await worker.stop();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

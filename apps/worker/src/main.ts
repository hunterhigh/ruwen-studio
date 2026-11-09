import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createApplicationRuntime,
  type Data,
  MODEL_MODES,
} from "@ruwen/agents";
import { runtimeSettings } from "../../../config/settings.ts";
import { WorkerService } from "./service.ts";

const env = fileURLToPath(new URL("../../../.env", import.meta.url));
if (process.env.RUWEN_SKIP_ENV_FILE !== "1" && existsSync(env))
  process.loadEnvFile(env);
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!(MODEL_MODES as readonly string[]).includes(process.env.MODEL_MODE ?? ""))
  throw new Error("MODEL_MODE must explicitly be faux, real, record or replay");
const execution = runtimeSettings().execution;
const modelRuntime = (request?: Data) =>
  createApplicationRuntime({
    mode: process.env.MODEL_MODE ?? "faux",
    workspaceRoot: fileURLToPath(new URL("../../../", import.meta.url)),
    scenario:
      typeof request?.simulation === "string"
        ? request.simulation
        : (process.env.FAUX_SCENARIO ?? runtimeSettings().faux.scenario),
    ...(process.env.FAUX_CHARACTER_DELAY_MS === undefined
      ? {}
      : { characterDelayMs: Number(process.env.FAUX_CHARACTER_DELAY_MS) }),
  });
const worker = new WorkerService(process.env.DATABASE_URL, {
  ...(process.env.WORKER_QUEUE ? { queue: process.env.WORKER_QUEUE } : {}),
  concurrency: Number(process.env.WORKER_CONCURRENCY ?? execution.concurrency),
  ...(process.env.ROLE_TIMEOUT_MS === undefined
    ? {}
    : { roleTimeoutMs: Number(process.env.ROLE_TIMEOUT_MS) }),
  queueMarginSeconds: Number(
    process.env.QUEUE_MARGIN_SECONDS ?? execution.queueMarginSeconds,
  ),
  runtime: () => modelRuntime(),
  runtimeForRequest: modelRuntime,
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

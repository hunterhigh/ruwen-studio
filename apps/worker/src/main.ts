import { fileURLToPath } from "node:url";
import {
  createApplicationRuntime,
  type Data,
  deploymentCanary,
  loadRuntimeEnvironment,
  MODEL_MODES,
} from "@ruwen/agents";
import { workerHealth } from "../../../config/health.ts";
import { reportError } from "../../../config/observability.ts";
import { runtimeSettings } from "../../../config/settings.ts";
import { configuredIdeation } from "./ideation-config.ts";
import { WorkerService } from "./service.ts";

const env = fileURLToPath(new URL("../../../.env", import.meta.url));
loadRuntimeEnvironment({
  root: fileURLToPath(new URL("../../../", import.meta.url)),
  file: env,
  skipFile: process.env.RUWEN_SKIP_ENV_FILE === "1",
});
deploymentCanary();
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
  ideation: configuredIdeation(),
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
  onError: (error) => reportError("worker_error", error),
});
const healthPort = Number(
  process.env.HEALTH_PORT ?? (process.env.NODE_ENV === "production" ? 8081 : 0),
);
if (!Number.isInteger(healthPort) || healthPort < 0 || healthPort > 65535)
  throw new Error("Invalid worker health port");
const health = healthPort
  ? workerHealth(
      worker.db,
      healthPort,
      process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1",
    )
  : null;
await health?.listen();
await worker.start();
health?.setReady(true);
console.log(
  JSON.stringify({ event: "worker_ready", mode: process.env.MODEL_MODE }),
);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await health?.close();
  await worker.stop();
  if (process.connected) process.disconnect();
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.on("message", (message: unknown) => {
  if (
    message &&
    typeof message === "object" &&
    "type" in message &&
    message.type === "ruwen-preview-stop"
  )
    void stop();
});
process.once("disconnect", stop);

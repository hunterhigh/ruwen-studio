import {
  flushObservability,
  initializeObservability,
  logEvent,
  protectConsole,
  reportError,
} from "../config/observability.ts";

// Shared sanitized service entrypoint for production images and the isolated human-started preview.
process.env.RUWEN_SKIP_ENV_FILE = "1";
protectConsole();
const fatal = async (event: string, error: unknown) => {
  reportError(event, error);
  await flushObservability();
  process.exit(1);
};
process.once("uncaughtException", (error) => {
  void fatal("uncaught_error", error);
});
process.once("unhandledRejection", (error) => {
  void fatal("unhandled_rejection", error);
});
try {
  initializeObservability();
  if (process.argv[2] === "web") await import("../apps/web/scripts/server.ts");
  else if (process.argv[2] === "worker")
    await import("../apps/worker/src/main.ts");
  else if (process.argv[2] === "migrate")
    await import("../apps/worker/scripts/migrate.ts");
  else throw new Error("Unknown production service");
  logEvent(
    process.argv[2] === "web"
      ? "web_ready"
      : process.argv[2] === "worker"
        ? "worker_ready"
        : "migration_complete",
  );
} catch (error) {
  await fatal("startup_failed", error);
}

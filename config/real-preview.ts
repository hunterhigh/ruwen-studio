import path from "node:path";
import { runtimeSettings } from "./settings.ts";

type Environment = Readonly<Record<string, string | undefined>>;
export function realPreviewCoordinates() {
  const config = runtimeSettings().preview.real;
  if (
    ![config.startupTimeoutMs, config.shutdownTimeoutMs].every(
      (value) => Number.isSafeInteger(value) && value > 0 && value <= 180000,
    )
  )
    throw new Error("Invalid real-preview lifecycle timeout");
  if (
    config.port !== 3001 ||
    config.databasePort !== 55329 ||
    config.databaseName !== "ruwen_real_preview" ||
    config.instance !== "real-preview" ||
    config.distDir !== ".next-real-preview"
  )
    throw new Error("Real preview must keep its dedicated local coordinates");
  return {
    ...config,
    baseURL: `https://localhost:${config.port}`,
    databaseURL: `postgresql://ruwen:local_test_only@127.0.0.1:${config.databasePort}/${config.databaseName}`,
  };
}
/** Billing/login exception is confined to the dedicated non-production loopback preview. */
export function isLocalRealPreview(env: Environment = process.env) {
  if (env.RUWEN_LOCAL_REAL_PREVIEW !== "1") return false;
  const config = realPreviewCoordinates();
  if (
    env.NODE_ENV === "production" ||
    env.LOCAL_PREVIEW !== "1" ||
    env.MODEL_PROFILE !== "deepseek" ||
    !["real", "faux"].includes(env.MODEL_MODE ?? "") ||
    env.DATABASE_URL !== config.databaseURL ||
    env.BETTER_AUTH_URL !== config.baseURL ||
    env.RUWEN_COOKIE_PREFIX !== "ruwen-real-preview" ||
    env.REAL_CHARGING_ENABLED !== "0" ||
    env.BILLING_SANDBOX_ENABLED !== "0" ||
    env.RUWEN_SKIP_ENV_FILE !== "1"
  )
    throw new Error("Invalid local real-preview boundary");
  return true;
}
export function realPreviewEnvironment(
  root: string,
  inherited: Environment,
  faux: boolean,
  secret: string,
  canary: string,
): NodeJS.ProcessEnv {
  const config = realPreviewCoordinates();
  const directory = path.join(root, ".local", config.instance);
  return {
    ...inherited,
    NODE_ENV: "development",
    PORT: String(config.port),
    PRODUCTION_TEST_PORT: String(config.port + 1),
    DATABASE_URL: config.databaseURL,
    PREVIEW_DATABASE_PORT: String(config.databasePort),
    PREVIEW_DATABASE_NAME: config.databaseName,
    PREVIEW_INSTANCE: config.instance,
    RUWEN_LOCAL_REAL_PREVIEW: "1",
    LOCAL_PREVIEW: "1",
    MODEL_MODE: faux ? "faux" : "real",
    MODEL_PROFILE: "deepseek",
    REAL_MODEL: faux ? "0" : "1",
    RUWEN_SKIP_ENV_FILE: "1",
    __NEXT_PROCESSED_ENV: "true",
    BETTER_AUTH_SECRET: secret,
    RUWEN_CANARY: canary,
    BETTER_AUTH_URL: config.baseURL,
    RUWEN_WORKSPACE_ROOT: root,
    RUWEN_COOKIE_PREFIX: "ruwen-real-preview",
    TLS_KEY_FILE: path.join(directory, "tls", "localhost-key.pem"),
    TLS_CERT_FILE: path.join(directory, "tls", "localhost-cert.pem"),
    WORKER_QUEUE: "ruwen-real-preview",
    HEALTH_PORT: "0",
    P3_GATE_PASSED: "0",
    REAL_CHARGING_ENABLED: "0",
    INVITE_ONLY: "1",
    BILLING_SANDBOX_ENABLED: "0",
    PAYMENT_PROVIDER: "mock",
    SMTP_URL: "",
    SMTP_FROM: "",
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    SEARCH_PROVIDER: "",
    SEARCH_API_KEY: "",
    SENTRY_DSN: "",
    HTTP_FROM_PROXY: "0",
    RUWEN_BUNDLED_DEMO: "0",
    NEXT_TELEMETRY_DISABLED: "1",
    ADMIN_EMAILS: inherited.ADMIN_EMAILS ?? "preview@ruwen.local",
  };
}

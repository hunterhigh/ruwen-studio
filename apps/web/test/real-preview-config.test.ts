import { randomBytes } from "node:crypto";
import path from "node:path";
import { currentBank } from "@ruwen/billing";
import { expect, it, vi } from "vitest";
import {
  previewConfiguration,
  previewDataDirectory,
} from "../../../config/preview.ts";
import {
  isLocalRealPreview,
  realPreviewCoordinates,
  realPreviewEnvironment,
} from "../../../config/real-preview.ts";
import { prepareRealPreviewEnvironment } from "../../../scripts/lib/real-preview-environment.ts";
import { previewLogLine } from "../../../scripts/lib/real-preview-processes.ts";

it("real-preview configuration isolates runtime, DB, cookies, queue, storage and payments without copying the key to arguments/files", () => {
  const key = randomBytes(32).toString("hex"),
    root = path.resolve(".local/config-test");
  const env = realPreviewEnvironment(
    root,
    {
      NODE_ENV: "production",
      DEEPSEEK_API_KEY: key,
      DATABASE_URL: "postgresql://ignored",
      REAL_CHARGING_ENABLED: "1",
      BILLING_SANDBOX_ENABLED: "1",
      SMTP_URL: "ignored",
      SEARCH_API_KEY: "ignored",
    },
    false,
    "auth-test-secret",
    "canary-test-marker",
  );
  expect(env.DEEPSEEK_API_KEY).toBe(key);
  expect(env).toMatchObject({
    PORT: "3001",
    PREVIEW_DATABASE_PORT: "55329",
    MODEL_MODE: "real",
    MODEL_PROFILE: "deepseek",
    REAL_MODEL: "1",
    RUWEN_SKIP_ENV_FILE: "1",
    REAL_CHARGING_ENABLED: "0",
    BILLING_SANDBOX_ENABLED: "0",
    LOCAL_PREVIEW: "1",
    SMTP_URL: "",
    SEARCH_API_KEY: "",
  });
  expect(isLocalRealPreview(env)).toBe(true);
  expect(previewConfiguration(env).databaseUrl).toBe(
    realPreviewCoordinates().databaseURL,
  );
  expect(previewDataDirectory(root, env)).toBe(
    path.join(root, ".local/real-preview"),
  );
  expect(previewDataDirectory(root, {})).toBe(path.join(root, ".local"));
  for (const bad of [
    { NODE_ENV: "production" },
    {
      DATABASE_URL:
        "postgresql://ruwen:local_test_only@127.0.0.1:54329/ruwen_dev",
    },
    { BETTER_AUTH_URL: "https://localhost:3000" },
    { MODEL_PROFILE: "default" },
    { REAL_CHARGING_ENABLED: "1" },
    { BILLING_SANDBOX_ENABLED: "1" },
  ])
    expect(() => isLocalRealPreview({ ...env, ...bad })).toThrow();
});
it("only the validated local preview charges sandbox for both chapter and ideation model modes", () => {
  const env = realPreviewEnvironment(
    path.resolve("."),
    {},
    false,
    "auth",
    "canary",
  );
  try {
    for (const [key, value] of Object.entries(env))
      if (value !== undefined) vi.stubEnv(key, value);
    expect(currentBank()).toBe("sandbox");
    expect(currentBank("real")).toBe("sandbox");
    vi.stubEnv("RUWEN_LOCAL_REAL_PREVIEW", "");
    expect(currentBank()).toBe("live");
    expect(currentBank("faux")).toBe("sandbox");
  } finally {
    vi.unstubAllEnvs();
  }
});
it("preflight reuses the shared process-key requirement without creating a model runtime; faux rehearsal strips even an inherited key", () => {
  try {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => prepareRealPreviewEnvironment(process.cwd(), false)).toThrow(
      "Missing or invalid DEEPSEEK_API_KEY",
    );
    const key = randomBytes(32).toString("hex");
    vi.stubEnv("DEEPSEEK_API_KEY", key);
    expect(
      prepareRealPreviewEnvironment(process.cwd(), false).DEEPSEEK_API_KEY,
    ).toBe(key);
    expect(
      prepareRealPreviewEnvironment(process.cwd(), true).DEEPSEEK_API_KEY,
    ).toBeUndefined();
  } finally {
    vi.unstubAllEnvs();
  }
});
it("preview output accepts only existing safe operational metadata, never raw errors, bodies or credentials", () => {
  const value = randomBytes(32).toString("hex");
  expect(previewLogLine(`provider error ${value}`)).toBeNull();
  const line = previewLogLine(
    JSON.stringify({
      event: "worker_error",
      error_type: "Error",
      message: value,
      api_key: value,
      body: "正文原文",
    }),
  );
  expect(line).toBe('{"event":"worker_error","error_type":"Error"}');
});

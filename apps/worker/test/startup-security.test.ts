import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { register } from "../../web/instrumentation.ts";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
it.each([
  "apps/worker/src/main.ts",
  "apps/web/scripts/server.ts",
  "scripts/preview.ts",
])("%s fails at startup before DB/listen/TLS work when the canary is absent or invalid", async (entry) => {
  for (const marker of [undefined, "INVALID_PRIVATE_MARKER"]) {
    const env = {
      ...process.env,
      RUWEN_SKIP_ENV_FILE: "1",
      DATABASE_URL: "postgresql://invalid.invalid/no-connection",
      MODEL_MODE: "faux",
      ...(marker === undefined ? {} : { RUWEN_CANARY: `${marker}\n` }),
    };
    if (marker === undefined) delete env.RUWEN_CANARY;
    const failure = (await exec(process.execPath, [entry], {
      cwd: root,
      env,
      windowsHide: true,
      timeout: 7000,
    }).catch((error: unknown) => error)) as {
      code: number;
      stdout: string;
      stderr: string;
    };
    expect(failure.code).toBe(1);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain(
      "RUWEN_CANARY must be a configured random marker",
    );
    expect(failure.stderr).not.toContain("INVALID_PRIVATE_MARKER");
    expect(failure.stderr).not.toContain("ECONN");
  }
});
it("Next Node instrumentation validates immediately, including direct Next CLI startup", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("RUWEN_CANARY", "");
  try {
    await expect(register()).rejects.toThrow("RUWEN_CANARY");
  } finally {
    vi.unstubAllEnvs();
  }
});

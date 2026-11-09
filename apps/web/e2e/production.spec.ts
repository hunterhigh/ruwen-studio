import { type ChildProcess, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

let server: ChildProcess;
test.beforeAll(async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: "3001",
    BETTER_AUTH_URL: "https://localhost:3001",
    BETTER_AUTH_SECRET: (
      await readFile(`${root}/.local/preview-auth-secret`, "utf8")
    ).trim(),
    DATABASE_URL:
      "postgresql://ruwen:local_test_only@127.0.0.1:54329/ruwen_dev",
    MODEL_MODE: "faux",
    LOCAL_PREVIEW: "0",
    RUWEN_SKIP_ENV_FILE: "1",
    REAL_MODEL: "0",
    REAL_CHARGING_ENABLED: "0",
    P3_GATE_PASSED: "0",
  };
  delete env.ANTHROPIC_API_KEY;
  server = spawn(process.execPath, ["apps/web/scripts/server.ts"], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Production HTTPS did not start")),
      20000,
    );
    server.stdout?.on("data", (chunk: Buffer) => {
      if (chunk.toString().includes("https://localhost:3001")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.once("exit", () => {
      clearTimeout(timer);
      reject(
        new Error(
          "Production HTTPS exited before ready; run pnpm build:web first",
        ),
      );
    });
  });
});
test.afterAll(() => {
  server?.kill("SIGTERM");
});
test("production build enforces CSP without browser violations and disables preview email", async ({
  page,
}) => {
  const violations: string[] = [],
    errors: string[] = [];
  page.on("console", (message) => {
    if (
      /violates.*Content Security Policy|Refused to execute/.test(
        message.text(),
      )
    )
      violations.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto("https://localhost:3001/sign-in");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).not.toMatch(
    /unsafe-inline|unsafe-eval/,
  );
  expect(response?.headers()["strict-transport-security"]).toContain(
    "max-age=",
  );
  await expect(
    page.getByRole("button", { name: "发送登录链接", exact: true }),
  ).toBeEnabled();
  expect(
    (
      await page.request.get("https://localhost:3001/api/preview/mail")
    ).status(),
  ).toBe(404);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});

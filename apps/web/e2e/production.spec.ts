import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { previewConfiguration } from "../../../config/preview.ts";
import { auditStudioPages } from "./frontend-acceptance.ts";
import { signIn } from "./helpers.ts";
import { captureFrame } from "./redesign-02.ts";
import { captureSignIn } from "./sign-in-capture.ts";

let server: ChildProcess;
test.beforeAll(async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const preview = previewConfiguration();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(previewConfiguration().productionPort),
    BETTER_AUTH_URL: previewConfiguration().productionUrl,
    BETTER_AUTH_SECRET: (
      await readFile(`${root}/.local/preview-auth-secret`, "utf8")
    ).trim(),
    DATABASE_URL: preview.databaseUrl,
    ADMIN_EMAILS: "preview@ruwen.local",
    RUWEN_COOKIE_PREFIX:
      preview.port === 3000 ? "ruwen" : `ruwen-preview-${preview.port}`,
    MODEL_MODE: "faux",
    LOCAL_PREVIEW: "0",
    RUWEN_SKIP_ENV_FILE: "1",
    REAL_MODEL: "0",
    REAL_CHARGING_ENABLED: "0",
    P3_GATE_PASSED: "0",
    NEXT_PUBLIC_RUWEN_PREVIEW_BANNER: "0",
    // Non-secret fixture values only. The test exercises server-rendered availability, never OAuth.
    GOOGLE_CLIENT_ID: "ui-fixture.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "ui-fixture",
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
      if (chunk.toString().includes(previewConfiguration().productionUrl)) {
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
  const response = await page.goto(
    `${previewConfiguration().productionUrl}/sign-in`,
  );
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).not.toMatch(
    /unsafe-inline|unsafe-eval/,
  );
  expect(await response?.text()).not.toMatch(/<[^>]+\sstyle=/i);
  expect(response?.headers()["strict-transport-security"]).toContain(
    "max-age=",
  );
  await expect(
    page.getByRole("button", { name: "发送登录邮件", exact: true }),
  ).toBeEnabled();
  expect(
    (
      await page.request.get(
        `${previewConfiguration().productionUrl}/api/preview/mail`,
      )
    ).status(),
  ).toBe(404);
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
  // Both self-hosted weights load under the unchanged font-src 'self' policy.
  const fonts = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('400 18px "Ruwen Serif"', "如文"),
      document.fonts.load('600 30px "Ruwen Serif"', "如文"),
    ]);
    return Array.from(document.fonts)
      .filter(
        (font) =>
          font.family.replaceAll('"', "") === "Ruwen Serif" &&
          font.status === "loaded",
      )
      .map((font) => font.weight);
  });
  expect(fonts).toEqual(expect.arrayContaining(["400", "600"]));
  expect(violations).toEqual([]);
  const gallery = await page.request.get(
    `${previewConfiguration().productionUrl}/dev/ui`,
  );
  expect(gallery.status()).toBe(404);
  expect(await gallery.text()).not.toContain("设计组件预览");
});

test("production sign-in shows configured Google and the sent state without a preview inbox", async ({
  page,
}) => {
  await page.goto(`${previewConfiguration().productionUrl}/sign-in`);
  await expect(
    page.getByRole("button", { name: "使用 Google 登录", exact: true }),
  ).toBeEnabled();
  await captureSignIn(page, "google-configured");
  // Keep the production page and real server props, replacing only email delivery.
  await page.route("**/api/login", (route) =>
    route.fulfill({
      json: { sent: true, previewMailbox: false },
    }),
  );
  const email = "reader@test.invalid";
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByRole("button", { name: "发送登录邮件", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(email);
  await expect(page.getByRole("status")).toContainText("链接 15 分钟内有效。");
  await expect(
    page.getByRole("button", { name: "打开本浏览器的预览邮件" }),
  ).toHaveCount(0);
  await captureSignIn(page, "email-sent");
});

test("every protected studio page redirects signed-out users to standalone sign-in", async ({
  page,
}) => {
  const base = previewConfiguration().productionUrl;
  const project = `/projects/${randomUUID()}`;
  for (const route of [
    "/",
    "/projects",
    project,
    `${project}/chapters`,
    `${project}/ideation`,
    `${project}/files`,
    "/account",
    "/admin",
    "/admin/reservations",
  ]) {
    await page.goto(new URL(route, base).href, {
      waitUntil: "domcontentloaded",
    });
    await expect(page, route).toHaveURL(/\/sign-in$/);
    await expect(
      page.getByRole("heading", { name: "登录如文", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".sidebar, .project-bar, .studio-main"),
    ).toHaveCount(0);
  }
});

test("production frame keeps the preview banner disabled and emits no inline styles", async ({
  page,
}) => {
  await signIn(page);
  const response = await page.goto(
    `${previewConfiguration().productionUrl}/projects`,
  );
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "书架", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".preview-banner")).toHaveCount(0);
  expect(await response?.text()).not.toMatch(/<[^>]+\sstyle=/i);
  await captureFrame(page, "shelf-production-banner-disabled");
});

test("all production surfaces keep SSR, type and CSP constraints", async ({
  page,
}) => {
  test.setTimeout(180000);
  await auditStudioPages(page);
});

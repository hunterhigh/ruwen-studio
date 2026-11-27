import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  previewConfiguration,
  productionBrowserTests,
} from "../../../config/preview.ts";
import { captureRedesign } from "./helpers.ts";

let galleryServer: ChildProcess | undefined;
let galleryUrl = "/dev/ui";

test.beforeAll(async () => {
  if (!productionBrowserTests()) return;
  // The production acceptance test independently verifies that this route is unavailable there.
  const port = previewConfiguration().productionPort + 1;
  const origin = `https://localhost:${port}`;
  galleryUrl = origin + galleryUrl;
  galleryServer = spawn(
    process.execPath,
    ["apps/web/scripts/server.ts", "--dev"],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env: { ...process.env, PORT: String(port), RUWEN_SKIP_ENV_FILE: "1" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let startupError = "";
  galleryServer.stderr?.on("data", (message: Buffer) => {
    startupError = (startupError + message.toString()).slice(-1200);
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Development gallery did not start")),
      30000,
    );
    galleryServer?.stdout?.on("data", (message: Buffer) => {
      if (message.toString().includes(origin)) {
        clearTimeout(timer);
        resolve();
      }
    });
    galleryServer?.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(`Development gallery exited with ${code}\n${startupError}`),
      );
    });
  });
});
test.afterAll(() => {
  galleryServer?.kill("SIGTERM");
});

test("development gallery: native focus, keyboard confirmation, toast expiry and recursive fields", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const response = await page.goto(galleryUrl);
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "设计组件预览", exact: true }),
  ).toBeVisible();
  await captureRedesign(page, "gallery");
  const trigger = page.getByRole("button", {
    name: "打开确认对话框",
    exact: true,
  });
  const dialog = page.getByRole("dialog");
  await trigger.click();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await captureRedesign(page, "gallery-dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("output")).toHaveText("已取消");
  await trigger.click();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  // Enter on the initially focused cancel button must never approve.
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("output")).toHaveText("已取消");
  await trigger.click();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "确认", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("output")).toHaveText("已确认");
  const unknown = page.getByText("此字段没有专用名称，默认折叠展示。", {
    exact: true,
  });
  await expect(unknown).toBeHidden();
  await page.getByText("其他", { exact: true }).click();
  await expect(unknown).toBeVisible();
  await unknown.scrollIntoViewIfNeeded();
  await captureRedesign(page, "gallery-fields");
  await page.clock.install({ time: new Date(0) });
  await page.clock.pauseAt(new Date(10000));
  await page.getByRole("button", { name: "显示短提示", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "提示已显示" }),
  ).toBeVisible();
  await captureRedesign(page, "gallery-toast");
  await page.clock.runFor(2199);
  await expect(
    page.getByRole("status").filter({ hasText: "提示已显示" }),
  ).toBeVisible();
  await page.clock.runFor(1);
  await expect(
    page.getByRole("status").filter({ hasText: "提示已显示" }),
  ).toHaveCount(0);
});

test("archive the reference design specification over loopback HTTP", async ({
  page,
}) => {
  test.skip(
    process.env.FRONTEND_RED01_SCREENSHOTS !== "1",
    "Local report evidence only",
  );
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const server = spawn(
    "python",
    [
      "-m",
      "http.server",
      "8765",
      "--bind",
      "127.0.0.1",
      "--directory",
      "docs/design",
    ],
    { cwd: root, windowsHide: true, stdio: "ignore" },
  );
  try {
    const url = "http://127.0.0.1:8765/ruwen-studio-redesign.html#spec";
    await expect
      .poll(async () => {
        try {
          return (await page.request.get(url)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto(url);
    await expect(page.locator('[data-page="spec"]')).toHaveClass(/active/);
    await captureRedesign(page, "reference-spec");
    await page
      .locator('[data-page="spec"] .component-row')
      .scrollIntoViewIfNeeded();
    await captureRedesign(page, "reference-components");
  } finally {
    server.kill("SIGTERM");
  }
});

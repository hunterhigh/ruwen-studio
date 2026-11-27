import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "@playwright/test";
import { Database } from "@ruwen/db";
export async function selectMessageRange(
  source: Locator,
  start: number,
  end: number,
) {
  await source.evaluate(
    (node, range) => {
      const input = node as HTMLTextAreaElement;
      input.focus();
      input.setSelectionRange(range.start, range.end);
      input.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { start, end },
  );
}

import { previewConfiguration } from "../../../config/preview.ts";

/** Independent UI-login fixtures in the fixed loopback-only preview, never a product bypass. */
async function resetPreviewLoginFixture(email: string) {
  const secret = (
    await readFile(
      new URL("../../../.local/preview-auth-secret", import.meta.url),
      "utf8",
    )
  ).trim();
  const db = new Database(previewConfiguration().databaseUrl);
  try {
    const keys = [
      "ip:127.0.0.1",
      "ip:::1",
      `email:${email.trim().toLowerCase()}`,
    ].map((key) => createHmac("sha256", secret).update(key).digest("hex"));
    await db.pool.query(
      "DELETE FROM web_rate_limits WHERE key_hash=ANY($1::text[])",
      [keys],
    );
  } finally {
    await db.close();
  }
}

export async function signIn(
  page: Page,
  email = `${randomUUID()}@test.invalid`,
) {
  // Limiter behavior itself is tested without this setup in web/test/security.test.ts.
  await resetPreviewLoginFixture(email);
  await page.goto("/sign-in");
  await page.getByLabel("邮箱", { exact: true }).fill(email);
  await page.getByLabel("如何称呼你").fill("试读者");
  await page.getByLabel("邀请码").fill("RUWEN-PREVIEW");
  await page.getByRole("button", { name: "发送登录链接" }).click();
  await page.getByRole("button", { name: "打开本浏览器的预览邮件" }).click();
  await expect(page).toHaveURL(/\/projects$/);
}
export async function createDemo(page: Page, title: string) {
  await page
    .getByRole("button", { name: "新建项目", exact: false })
    .first()
    .click();
  await page.getByLabel("项目名称").fill(title);
  await page.getByLabel("从哪里开始").selectOption("demo");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  await expect(
    page.getByText("写作前的资料已就绪", { exact: true }),
  ).toBeVisible();
  return page.url().split("/").at(-1) ?? "";
}

/** Block 1 evidence is opt-in so CI never rewrites checked-in screenshots. */
export async function captureRedesign(page: Page, name: string) {
  if (process.env.FRONTEND_RED01_SCREENSHOTS !== "1") return;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.fonts.ready);
  const directory = new URL(
    "../../../docs/reports/frontend-redesign/01/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, directory)),
    fullPage: false,
  });
}
export async function confirmAction(
  page: Page,
  trigger: Locator,
  label: string,
  name: string,
) {
  await trigger.scrollIntoViewIfNeeded();
  await captureRedesign(page, `${name}-page`);
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  const mutations: string[] = [];
  const record = (request: import("@playwright/test").Request) => {
    if (request.method() === "POST") mutations.push(request.url());
  };
  page.on("request", record);
  try {
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(mutations).toEqual([]);
    await trigger.click();
    await expect(dialog).toBeVisible();
    await captureRedesign(page, `${name}-confirm`);
    expect(mutations).toEqual([]);
  } finally {
    page.off("request", record);
  }
  await dialog.getByRole("button", { name: label, exact: true }).click();
}

export async function createDemoFromShelf(page: Page, title: string) {
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "新建项目" });
  await dialog.getByRole("textbox", { name: "书名", exact: true }).fill(title);
  await dialog.getByRole("radio", { name: /^演示项目/ }).check();
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  await expect(
    page.getByText("写作前的资料已就绪", { exact: true }),
  ).toBeVisible();
  return page.url().split("/").at(-1) ?? "";
}

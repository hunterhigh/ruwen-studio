import { createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";
import { Database } from "@ruwen/db";
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
    page.getByRole("heading", { name: "项目资料已就绪" }),
  ).toBeVisible();
  return page.url().split("/").at(-1) ?? "";
}

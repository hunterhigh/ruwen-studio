import { mkdir } from "node:fs/promises";
import { expect, type Page } from "@playwright/test";

export async function checkAccountHtml(page: Page) {
  const html = await page
    .locator(".account-page")
    .evaluate((main) => main.outerHTML);
  expect(html).not.toMatch(/USD|\$|token|缓存/i);
}

export async function captureAccount(page: Page, file: string) {
  await checkAccountHtml(page);
  if (process.env.FRONTEND_RED09_SCREENSHOTS !== "1") return;
  const folder = "docs/reports/frontend-redesign/09";
  await mkdir(folder, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${folder}/${file}.png`,
    animations: "disabled",
  });
}

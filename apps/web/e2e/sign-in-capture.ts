import { mkdir } from "node:fs/promises";
import type { Page } from "@playwright/test";

export async function captureSignIn(page: Page, name: string) {
  if (process.env.FRONTEND_RED10_SCREENSHOTS !== "1") return;
  const folder = "docs/reports/frontend-redesign/10";
  await mkdir(folder, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${folder}/${name}.png`,
    animations: "disabled",
  });
}

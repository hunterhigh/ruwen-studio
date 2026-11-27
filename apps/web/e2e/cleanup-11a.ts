import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function captureCleanup(page: Page, id: string) {
  const capture = process.env.FRONTEND_RED11A_SCREENSHOTS;
  if (capture !== "1" && capture !== id) return;
  await page.setViewportSize({ width: 1440, height: 900 });
  const projectBar = page.locator(".project-bar[aria-busy]");
  if (await projectBar.count())
    await expect(projectBar).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() => document.fonts.ready);
  const folder = new URL(
    "../../../docs/reports/frontend-redesign/11a/",
    import.meta.url,
  );
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${id}-after.png`, folder)),
    animations: "disabled",
  });
}

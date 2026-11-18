import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

/** Opt-in evidence only; CI must not rewrite checked-in report images. */
export async function captureFrame(page: Page, name: string) {
  if (process.env.FRONTEND_RED02_SCREENSHOTS !== "1") return;
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await page.locator(".project-bar[aria-busy]").count()) {
    await expect(page.locator(".project-bar[aria-busy]")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const directory = new URL(
    "../../../docs/reports/frontend-redesign/02/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, directory)),
    fullPage: false,
    animations: "disabled",
  });
}

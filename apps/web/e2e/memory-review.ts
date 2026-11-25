import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

export async function captureMemory(page: Page, name: string) {
  if (process.env.FRONTEND_RED04_SCREENSHOTS !== "1") return;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  const directory = new URL(
    "../../../docs/reports/frontend-redesign/04/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, directory)),
    animations: "disabled",
  });
}

export async function readMemory(page: Page, archive = false) {
  const files = page.locator(".memory-file-row");
  const submit = page.getByRole("button", {
    name: "提交资料变更",
    exact: true,
  });
  const mark = page.getByRole("checkbox", { name: "已阅", exact: true });
  await expect(files.first()).toBeVisible();
  const total = await files.count();
  for (let index = 0; index < total; index++) {
    await expect(files.nth(index)).toHaveAttribute("aria-current", "true");
    await expect(submit).toBeDisabled();
    await mark.check();
    if (archive && index === 0 && total > 1) {
      await expect(files.nth(1)).toHaveAttribute("aria-current", "true");
      await captureMemory(page, "partial");
    }
  }
  await expect(submit).toBeEnabled();
  if (archive) await captureMemory(page, "all-read");
}

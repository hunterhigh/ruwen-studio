import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

export async function startChapter(
  page: Page,
  scenario?: string,
  chapter?: string,
) {
  await page.getByRole("button", { name: "写新的一章", exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (chapter) await dialog.getByLabel("章节号", { exact: true }).fill(chapter);
  if (scenario)
    await dialog
      .getByRole("combobox", { name: "模拟场景", exact: true })
      .selectOption(scenario);
  await dialog.getByRole("button", { name: "开始写作", exact: true }).click();
}

export async function readCandidate(page: Page) {
  await page.locator(".chapter-end").scrollIntoViewIfNeeded();
  await page.locator(".chapter-verdicts").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "批准正文", exact: true }),
  ).toBeEnabled();
}

export function decisionRefreshAfter(page: Page, action: string) {
  let accepted = false;
  return page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    const method = response.request().method();
    if (
      path.startsWith("/api/runs/") &&
      path.endsWith(`/${action}`) &&
      method === "POST" &&
      response.ok()
    )
      accepted = true;
    return (
      accepted && method === "GET" && path === "/api/projects" && response.ok()
    );
  });
}

export async function captureChapter(page: Page, name: string) {
  if (process.env.FRONTEND_RED03_SCREENSHOTS !== "1") return;
  await page.setViewportSize({ width: 1440, height: 900 });
  if (await page.locator(".project-bar[aria-busy]").count()) {
    await expect(page.locator(".project-bar")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  }
  await page.evaluate(() => document.fonts.ready);
  const directory = new URL(
    "../../../docs/reports/frontend-redesign/03/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, directory)),
    animations: "disabled",
  });
}

import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import type { IdeationPreviewV1_2 as Preview } from "@ruwen/pipeline";
import { ideationCopy as c } from "../src/copy/zh-CN.ts";

export function inbox(page: Page) {
  return page.getByRole("region", { name: c.inbox, exact: true });
}
export function previewCard(page: Page) {
  return page.getByRole("article", { name: c.previewDetails, exact: true });
}
export function sessionButton(page: Page, title: string) {
  return page
    .getByRole("complementary", { name: c.sessions, exact: true })
    .getByRole("button")
    .filter({ has: page.getByText(title, { exact: true }) });
}
export async function createIdeationSession(page: Page, title: string) {
  await page.getByRole("button", { name: c.newSession, exact: true }).click();
  const field = page.getByRole("textbox", { name: c.sessionName, exact: true });
  await field.fill(title);
  await field.press("Enter");
  await expect(sessionButton(page, title)).toHaveAttribute(
    "aria-current",
    "true",
  );
  await expect(
    page.getByRole("textbox", { name: c.composer, exact: true }),
  ).toBeEnabled();
}
export async function selectPreviewKind(
  page: Page,
  kind: Preview["kind"],
  processed = false,
) {
  const tab = inbox(page).getByRole("button", {
    name: processed ? c.processed : /^待你决定 /,
  });
  if ((await tab.getAttribute("aria-pressed")) !== "true") await tab.click();
  const entry = inbox(page)
    .getByRole("region", { name: c.previewList, exact: true })
    .locator(`button[data-kind="${kind}"]`)
    .first();
  await expect(entry).toBeVisible();
  if ((await entry.getAttribute("aria-expanded")) !== "true")
    await entry.click();
  return entry;
}
export async function approvePreviewKind(page: Page, kind: Preview["kind"]) {
  const card = previewCard(page);
  await card
    .getByRole("checkbox", { name: c.confirm[kind], exact: true })
    .check();
  await card
    .getByRole("button", { name: c.approve[kind], exact: true })
    .click();
  await expect(card).toContainText("已批准");
  await expect(
    inbox(page).getByRole("button", { name: c.processed, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
}
export async function compileIdeationChapter(page: Page, chapter: string) {
  const toggle = inbox(page).getByRole("button", {
    name: c.compile,
    exact: true,
  });
  if ((await toggle.getAttribute("aria-expanded")) !== "true")
    await toggle.click();
  await inbox(page).getByLabel(c.compileChapter, { exact: true }).fill(chapter);
  await inbox(page)
    .getByRole("button", { name: c.compileStart, exact: true })
    .click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
}
export async function captureIdeation05(
  page: Page,
  name: string,
  focus?: "card" | "inbox",
) {
  if (process.env.FRONTEND_RED05_SCREENSHOTS !== "1") return;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.fonts.ready);
  if (focus) {
    await inbox(page).evaluate((panel, focus) => {
      const card = panel.querySelector(".ideation-preview-card");
      panel.scrollTop =
        focus === "card" && card
          ? panel.scrollTop +
            card.getBoundingClientRect().top -
            panel.getBoundingClientRect().top -
            28
          : 0;
    }, focus);
  }
  const directory = new URL(
    "../../../docs/reports/frontend-redesign/05/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, directory)),
    animations: "disabled",
  });
}

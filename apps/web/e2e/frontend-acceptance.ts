import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "@playwright/test";
import { previewConfiguration } from "../../../config/preview.ts";
import {
  adminCopy,
  memoryCopy,
  runStatus,
  signInCopy,
} from "../src/copy/zh-CN.ts";
import { createDemoFromShelf, signIn } from "./helpers.ts";

export async function auditStudioPages(page: Page) {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Reflect.set(window, "ruwenTestCspViolations", violations);
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(event.effectiveDirective);
    });
  });

  const base = previewConfiguration().productionUrl;
  async function check(path: string, ready: Locator, status = 200) {
    const response = await page.goto(new URL(path, base).href);
    expect(response?.status(), path).toBe(status);
    expect(response?.headers()["content-security-policy"], path).toBeTruthy();
    expect(response?.headers()["content-security-policy"], path).not.toMatch(
      /unsafe-inline|unsafe-eval/,
    );
    expect(await response?.text(), path).not.toMatch(/<[^>]+\sstyle\s*=/i);
    await expect(ready, path).toBeVisible();
    await expect(page.getByTestId("loading-skeleton"), path).toHaveCount(0);

    const checked = await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('400 18px "Ruwen Serif"', "如文"),
        document.fonts.load('600 30px "Ruwen Serif"', "如文"),
      ]);
      await document.fonts.ready;
      return {
        weights: Array.from(document.fonts)
          .filter(
            (font) =>
              font.family.replaceAll('"', "") === "Ruwen Serif" &&
              font.status === "loaded",
          )
          .map((font) => font.weight),
        violations: Reflect.get(window, "ruwenTestCspViolations") as string[],
        text: document.body.innerText,
      };
    });
    expect(checked.weights, path).toEqual(
      expect.arrayContaining(["400", "600"]),
    );
    expect(checked.violations, path).toEqual([]);
    if (!path.startsWith("/admin"))
      expect(checked.text, path).not.toMatch(/USD|\$|待\s*P3|JSON/i);
  }

  await check(
    "/sign-in",
    page.getByRole("button", { name: signInCopy.submit, exact: true }),
  );
  await signIn(page, "preview@ruwen.local");
  const id = await createDemoFromShelf(page, "生产页面验收");
  const root = `/projects/${id}`;
  await check("/projects", page.locator(".shelf-grid .book-cover").first());
  await check(root, page.locator(".overview-steps"));
  await check(`${root}/ideation`, page.locator(".ideation-desk"));
  await check(`${root}/files`, page.locator(".files-browser"));
  await check("/account", page.locator(".account-grid"));

  const run = randomUUID();
  const original = "第一章　驿站\n\n林川翻开来信。";
  let status: "AWAITING_CANDIDATE_APPROVAL" | "AWAITING_MEMORY_APPROVAL" =
    "AWAITING_CANDIDATE_APPROVAL";
  await page.route(`**/api${root}/runs`, (route) =>
    route.fulfill({
      json: [{ id: run, kind: "chapter_run", chapter: "001", status }],
    }),
  );
  await page.route(`**/api/runs/${run}/events`, (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: "retry: 60000\nevent: heartbeat\ndata: {}\n\n",
    }),
  );
  await page.route(`**/api/runs/${run}`, (route) =>
    route.fulfill({
      json: {
        run: {
          id: run,
          chapter: "001",
          status,
          candidateSha256: "a".repeat(64),
          memoryPreviewSha256: "b".repeat(64),
          events: [],
        },
        original,
        prose: original,
        reports: {},
        roles: [],
        annotations: [],
        memoryFiles: [],
      },
    }),
  );
  await check(`${root}/chapters`, page.getByTestId("run-status"));
  await expect(page.getByTestId("run-status")).toHaveText(runStatus[status]);
  status = "AWAITING_MEMORY_APPROVAL";
  await check(
    `${root}/chapters?view=memory`,
    page.getByRole("heading", {
      name: memoryCopy.summary.new_facts,
      exact: true,
    }),
  );
  await check(
    "/admin",
    page.getByRole("heading", { name: adminCopy.overview, exact: true }),
  );
  await expect(page.locator(".admin-page .page-heading .eyebrow")).toHaveCount(
    0,
  );
  await check(
    "/admin/reservations",
    page.getByRole("heading", { name: adminCopy.review.heading, exact: true }),
  );
  await expect(page.locator(".admin-page .eyebrow")).toHaveText(
    `${adminCopy.section} / ${adminCopy.billingReview}`,
  );
  await check(
    "/missing-frontend-acceptance",
    page.locator(".not-found-paper"),
    404,
  );
}

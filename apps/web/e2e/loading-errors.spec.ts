import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { previewConfiguration } from "../../../config/preview.ts";
import { createDemoFromShelf, signIn } from "./helpers.ts";

const rawCode = "INTERNAL_UNEXPECTED_11B";
const rawMessage = `TypeError at C:\\private\\runtime.ts:42\n${rawCode}`;
const failure = { ok: false, error: { code: rawCode, message: rawMessage } };
const viewport = { width: 1440, height: 900 };
test.use({ viewport });

let projectId: string;

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function capture(page: Page, name: string) {
  if (process.env.FRONTEND_RED11B_SCREENSHOTS !== "1") return;
  await page.evaluate(() => document.fonts.ready);
  const folder = new URL(
    "../../../docs/reports/frontend-redesign/11b/",
    import.meta.url,
  );
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, folder)),
    animations: "disabled",
  });
}

test.describe("user page loading and errors", () => {
  let sessionCookies: Awaited<ReturnType<BrowserContext["cookies"]>>;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      baseURL: previewConfiguration().baseUrl,
      ignoreHTTPSErrors: true,
    });
    try {
      const page = await context.newPage();
      await signIn(page);
      projectId = await createDemoFromShelf(page, "冬夜信笺 · 页面状态");
      sessionCookies = await context.cookies();
    } finally {
      await context.close();
    }
  });

  test("project ZIP export offers a local retry and still downloads", async ({
    page,
  }) => {
    await page.context().addCookies(sessionCookies);
    const projectPath = `/projects/${projectId}`;
    const endpoint = `**/api${projectPath}/export`;
    await page.route(endpoint, (route) =>
      route.fulfill({ status: 500, json: failure }),
    );
    await page.goto(projectPath);
    await page.getByRole("button", { name: "导出 ZIP", exact: true }).click();
    const notice = page.getByTestId("inline-notice");
    await expect(notice.getByRole("alert")).toBeVisible();
    await expect(page.locator("main")).not.toContainText(
      "INTERNAL_UNEXPECTED_11B",
    );
    await expect(page).toHaveURL(new RegExp(`${projectPath}$`));
    await page.unroute(endpoint);
    const download = page.waitForEvent("download");
    await notice.getByRole("button", { name: "重试", exact: true }).click();
    expect((await download).suggestedFilename()).toBe(`ruwen-${projectId}.zip`);
    await expect(notice).toHaveCount(0);
  });

  const views = [
    { page: "shelf", path: "/projects", endpoint: "/api/projects" },
    { page: "overview", path: "", endpoint: "" },
    { page: "ideation", path: "/ideation", endpoint: "/ideation/sessions" },
    { page: "chapter", path: "/chapters", endpoint: "/runs" },
    { page: "memory", path: "/chapters?view=memory", endpoint: "/runs" },
    { page: "files", path: "/files", endpoint: "/files" },
    { page: "account", path: "/account", endpoint: "/api/account" },
    { page: "signIn", path: "/sign-in", endpoint: "/api/login" },
  ] as const;

  for (const view of views) {
    test(`${view.page} shows its skeleton and slow hint, then a safe error`, async ({
      page,
    }) => {
      const login = view.page === "signIn";
      if (!login) await page.context().addCookies(sessionCookies);
      const root = `/projects/${projectId}`;
      const projectView =
        view.page !== "shelf" && view.page !== "account" && !login;
      const routePath = projectView ? root + view.path : view.path;
      let api = projectView ? `/api${root}${view.endpoint}` : view.endpoint;
      if (view.page === "chapter" || view.page === "memory") {
        const run = randomUUID();
        const runList = api;
        await page.route(
          (url) => url.pathname === runList,
          (route) =>
            route.fulfill({
              json: [
                {
                  id: run,
                  kind: "chapter_run",
                  chapter: "001",
                  status: "DONE",
                },
              ],
            }),
        );
        api = `/api/runs/${run}`;
      }
      const endpoint = (url: URL) =>
        url.pathname === api &&
        (view.page !== "files" || !url.searchParams.has("path"));
      const gate = deferred();
      const entered = deferred();
      await page.route(endpoint, async (route) => {
        if (route.request().method() !== (login ? "POST" : "GET"))
          return route.fallback();
        entered.resolve();
        await gate.promise;
        await route.fulfill({ status: 500, json: failure });
      });
      const now = Date.now();
      await page.clock.install({ time: new Date(now) });
      await page.clock.pauseAt(new Date(now + 2_000));
      const name = login ? "sign-in" : view.page;
      try {
        await page.goto(routePath);
        if (login) {
          await page
            .getByLabel("邮箱", { exact: true })
            .fill("writer@test.invalid");
          await page
            .getByRole("button", { name: "发送登录邮件", exact: true })
            .click();
        }
        await entered.promise;
        const skeleton = page
          .getByTestId("loading-skeleton")
          .and(page.locator(`[data-page="${view.page}"]`));
        const slow = skeleton.getByTestId("slow-load");
        await expect(skeleton).toBeVisible();
        await expect(slow).toHaveCount(0);
        await capture(page, `${name}-skeleton`);
        await page.clock.runFor(9_999);
        await expect(slow).toHaveCount(0);
        await page.clock.runFor(1);
        await expect(slow).toContainText("加载得比平时慢，可以刷新重试");
        await expect(
          slow.getByRole("button", { name: "刷新", exact: true }),
        ).toBeEnabled();
        if (view.page === "shelf") await capture(page, "slow");
        gate.resolve();
        const notice = page.getByTestId("inline-notice");
        await expect(notice.getByRole("alert")).toBeVisible();
        await expect(notice.getByRole("button")).toBeEnabled();
        await expect(skeleton).toHaveCount(0);
        await expect(page.locator("main")).not.toContainText(
          /INTERNAL_UNEXPECTED_11B|TypeError|runtime\.ts/,
        );
        await capture(page, `${name}-error`);
        if (view.page === "shelf") {
          await page.unroute(endpoint);
          await notice
            .getByRole("button", { name: "重试", exact: true })
            .click();
          await expect(notice).toHaveCount(0);
          await expect(
            page.getByText("冬夜信笺 · 页面状态", { exact: true }),
          ).toBeVisible();
        }
      } finally {
        gate.resolve();
      }
    });
  }
});

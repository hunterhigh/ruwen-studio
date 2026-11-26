import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ideationCopy as c } from "../src/copy/zh-CN.ts";
import { startChapter } from "./chapter-review.ts";
import { createDemoFromShelf as createDemo, signIn } from "./helpers.ts";
import { createIdeationSession } from "./ideation-review.ts";
import { captureFrame } from "./redesign-02.ts";

test("global frame: real project decisions, every navigation mode, persistent banner and confirmed sign-out", async ({
  page,
}) => {
  test.setTimeout(240000);
  await signIn(page, `frame-${randomUUID().slice(0, 6)}@mail.test`);
  const banner = page.getByRole("complementary", {
    name: "开发预览",
    exact: true,
  });
  await expect(banner).toContainText("当前使用模拟模型");
  await captureFrame(page, "shelf-banner-on");
  const id = await createDemo(page, "河谷驿站");
  const projectNav = page.getByRole("navigation", {
    name: "项目导航",
    exact: true,
  });
  const mainNav = page.getByRole("navigation", { name: "主导航", exact: true });
  await expect(page.locator(".project-bar-title")).toContainText("河谷驿站");
  await expect(page.locator(".decision-chip")).toHaveCount(0);
  await expect(
    mainNav.getByRole("link", { name: "书架", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(mainNav.getByRole("link", { name: "管理工作室" })).toHaveCount(
    0,
  );
  await captureFrame(page, "overview-no-decisions");
  await projectNav.getByRole("link", { name: "故事构思", exact: true }).click();
  await createIdeationSession(page, "驿站的故事");
  await page
    .getByLabel("想和协调员说的话", { exact: true })
    .fill("让主人公在河谷驿站遇到来信的人。");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  await expect(
    page.getByRole("region", { name: "构思预览工作台", exact: true }),
  ).toContainText("创意通讯门");
  await expect(page.locator(".decision-chip .badge-count")).toHaveText("1");
  await expect(
    projectNav.getByRole("link", { name: "故事构思", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await captureFrame(page, "ideation-decisions");
  await page.locator(".decision-chip").click();
  await expect(page).toHaveURL(new RegExp(`${id}#decisions$`));
  await expect(page.locator("#decisions")).toBeInViewport();
  await expect(
    page.getByRole("heading", { name: "项目资料已就绪", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".decision-chip .badge-count")).toHaveText("1");
  await page.evaluate(() => window.scrollTo(0, 0));
  await captureFrame(page, "overview-decisions");
  await projectNav.getByRole("link", { name: "章节写作", exact: true }).click();
  await startChapter(page);
  await expect(page.getByTestId("run-status")).toHaveText("等你阅读与批准", {
    timeout: 90000,
  });
  await expect(page.locator(".decision-chip .badge-count")).toHaveText("2");
  await captureFrame(page, "chapters-decisions");
  await projectNav.getByRole("link", { name: "项目资料", exact: true }).click();
  await expect(page.locator(".file-tree button").first()).toBeVisible();
  await captureFrame(page, "files");
  // Minimum desktop width must retain the bar and all four modes without overflow.
  await page.setViewportSize({ width: 1180, height: 900 });
  expect(
    await page
      .locator(".project-bar")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  expect(
    await page
      .locator(".sidebar")
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBe(184);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".quiet-link")).toHaveAttribute(
    "href",
    `/api/projects/${id}/export`,
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".quiet-link").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/i);
  await mainNav.getByRole("link", { name: "账户与用量", exact: true }).click();
  await expect(page.locator(".page-heading")).toContainText("@mail.test");
  await expect(
    mainNav.getByRole("link", { name: "账户与用量", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await captureFrame(page, "account");
  await expect(page.locator(".studio-main")).not.toContainText(
    /待\s*P3\s*(实测|校准)/,
  );
  await banner.getByRole("button", { name: "本次不再显示" }).click();
  await mainNav.getByRole("link", { name: "书架", exact: true }).click();
  await page.reload();
  await expect(banner).toHaveCount(0);
  await captureFrame(page, "shelf-banner-dismissed");
  const signOut = page.getByRole("button", { name: "退出登录", exact: true });
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/auth/sign-out"))
      posts.push(r.url());
  });
  await signOut.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("未发送的消息不会保存。");
  await expect(
    dialog.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await captureFrame(page, "signout-confirm");
  await page.keyboard.press("Escape");
  expect(posts).toEqual([]);
  await expect(signOut).toBeFocused();
  await signOut.click();
  await dialog.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(posts).toHaveLength(1);
  expect((await page.request.get(`/api/projects/${id}/files`)).status()).toBe(
    401,
  );
});

test("decision count uses all pages, the newest ten sessions, and chapter-only fallback on failure", async ({
  page,
}) => {
  await signIn(page);
  const id = await createDemo(page, "分页计数检查");
  const root = `/projects/${id}`;
  let fail = false;
  const loaded: number[] = [];
  await page.route("**/api/projects", async (route) => {
    const response = await route.fetch();
    const projects = await response.json();
    await route.fulfill({
      json: projects.map((p: { id: string }) =>
        p.id === id ? { ...p, pending: 2 } : p,
      ),
    });
  });
  await page.route(
    `**/api/projects/${id}/ideation/sessions*`,
    async (route) => {
      const url = new URL(route.request().url());
      const items = Array.from({ length: 12 }, (_, i) => ({
        id: `s-${i}`,
        createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      }));
      await route.fulfill({
        json: {
          ok: true,
          value: {
            items: url.searchParams.has("after")
              ? items.slice(6)
              : items.slice(0, 6),
            nextCursor: url.searchParams.has("after") ? null : "6",
          },
        },
      });
    },
  );
  await page.route(
    `**/api/projects/${id}/ideation/sessions/*/previews*`,
    async (route) => {
      const url = new URL(route.request().url());
      loaded.push(Number(url.pathname.match(/s-(\d+)/)?.[1]));
      if (fail && url.searchParams.has("after"))
        return route.fulfill({ status: 503, json: { error: "fixture" } });
      await route.fulfill({
        json: {
          ok: true,
          value: {
            items: [
              { id: `${url.pathname}-${url.search}`, status: "pending" },
              { status: "approved" },
            ],
            nextCursor: url.searchParams.has("after") ? null : "1",
          },
        },
      });
    },
  );
  await page.reload();
  await expect(page.locator(".decision-chip .badge-count")).toHaveText("22");
  expect(new Set(loaded)).toEqual(
    new Set(Array.from({ length: 10 }, (_, i) => i + 2)),
  );
  fail = true;
  await page.reload();
  await expect(page.locator(".decision-chip .badge-count")).toHaveText("2");
  await expect(page.locator('.studio-main [role="alert"]')).toHaveCount(0);
  // With no chapter approvals, an ideation outage hides the entire mark.
  await page.unroute("**/api/projects");
  await page.reload();
  await expect(page.locator(".decision-chip")).toHaveCount(0);
  expect(page.url()).toContain(root);
});

test("banner handles non-faux settings and blocked sessionStorage without page errors", async ({
  page,
}) => {
  await signIn(page, `banner-${randomUUID().slice(0, 6)}@mail.test`);
  await page.route("**/api/settings", (route) =>
    route.fulfill({ json: { mode: "replay" } }),
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.reload();
  const banner = page.getByRole("complementary", {
    name: "开发预览",
    exact: true,
  });
  await expect(banner).toHaveText("开发预览：点数与价格尚待实测。本次不再显示");
  await captureFrame(page, "banner-non-faux");
  await banner.getByRole("button").click();
  await expect(banner).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("slow decision reads finish before polling starts another aggregation", async ({
  page,
}) => {
  await signIn(page);
  const id = await createDemo(page, "慢速读取检查");
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  await page.route(
    `**/api/projects/${id}/ideation/sessions*`,
    async (route) => {
      reads++;
      await pending;
      await route.fulfill({
        json: { ok: true, value: { items: [], nextCursor: null } },
      });
    },
  );
  await page.clock.install();
  await page.reload();
  await expect.poll(() => reads).toBeGreaterThan(0);
  // Development Strict Mode can start two initial effects. Measure subsequent polls.
  await page.clock.runFor(1000);
  const initialReads = reads;
  await page.clock.runFor(45000);
  expect(reads).toBe(initialReads);
  release();
  await expect(page.locator(".project-bar")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  const completedReads = reads;
  await page.clock.runFor(15000);
  await expect.poll(() => reads).toBeGreaterThan(completedReads);
});

test("administrator keeps the shared frame and additional navigation", async ({
  page,
}) => {
  await signIn(page, "preview@ruwen.local");
  const navigation = page.getByRole("navigation", {
    name: "主导航",
    exact: true,
  });
  await navigation
    .getByRole("link", { name: "管理工作室", exact: true })
    .click();
  await expect(
    navigation.getByRole("link", { name: "管理工作室", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await captureFrame(page, "admin");
  await page.goto("/admin/reservations");
  await expect(
    page.getByRole("heading", { name: "待核对预留", exact: true }),
  ).toBeVisible();
  await captureFrame(page, "admin-reservations");
});

test("archive block 2 prototype pages over loopback HTTP", async ({ page }) => {
  test.skip(
    process.env.FRONTEND_RED02_SCREENSHOTS !== "1",
    "Local report evidence only",
  );
  const server = spawn(
    "python",
    [
      "-m",
      "http.server",
      "8765",
      "--bind",
      "127.0.0.1",
      "--directory",
      "docs/design",
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      windowsHide: true,
      stdio: "ignore",
    },
  );
  try {
    const root = "http://127.0.0.1:8765/ruwen-studio-redesign.html";
    await expect
      .poll(async () => {
        try {
          return (await page.request.get(root)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    for (const mode of [
      "shelf",
      "overview",
      "ideation",
      "chapter",
      "files",
      "account",
    ]) {
      // A fresh document avoids same-document hash scroll anchoring in evidence.
      await page.goto(`${root}?reference=${mode}#${mode}`);
      await expect(page.locator(`[data-page="${mode}"]`)).toHaveClass(/active/);
      await captureFrame(page, `reference-${mode}`);
    }
    await page.locator('[data-dialog="signout"]').click();
    await captureFrame(page, "reference-signout");
  } finally {
    server.kill("SIGTERM");
  }
});

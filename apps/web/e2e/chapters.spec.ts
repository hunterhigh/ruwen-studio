import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { exportProjectZip, LocalDirFS, type ProjectFS } from "@ruwen/core";

import { createDemo, signIn } from "./helpers.ts";

test("imported user Markdown cannot execute HTML, load images or create non-https links", async ({
  page,
}) => {
  await signIn(page);
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("tracker.invalid"))
      externalRequests.push(request.url());
  });
  const text =
    '# 安全阅读样本\n\n<script>globalThis.XSS_SENTINEL=1</script>\n\n<img src="https://tracker.invalid/html">\n\n![追踪图片](https://tracker.invalid/image)\n\n[不安全链接](http://tracker.invalid/link) [允许的链接](https://example.com/read)';
  class UploadedProject extends LocalDirFS {
    // Read-only virtual upload fixture; LocalDirFS's normal transaction clones into a base instance.
    override transaction<T>(fn: (fs: ProjectFS) => Promise<T>): Promise<T> {
      return fn(this);
    }
    override async read(p: string) {
      return p === "DEMO.md" ? new TextEncoder().encode(text) : super.read(p);
    }
  }
  const source = new UploadedProject(
    fileURLToPath(new URL("../../../fixtures/demo-project", import.meta.url)),
  );
  const bytes = await exportProjectZip(source);
  await expect(page.locator('input[type="file"]')).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({
    name: "用户资料.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(bytes),
  });
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  await page.getByRole("link", { name: "项目资料", exact: true }).click();
  await page.getByRole("button", { name: "DEMO.md", exact: true }).click();
  const content = page.locator(".file-content");
  await expect(
    content.getByRole("heading", { name: "安全阅读样本", exact: true }),
  ).toBeVisible();
  await expect(content.locator("img,script,iframe")).toHaveCount(0);
  await expect(content.getByRole("link", { name: "不安全链接" })).toHaveCount(
    0,
  );
  await expect(
    content.getByRole("link", { name: "允许的链接" }),
  ).toHaveAttribute("rel", "noopener noreferrer nofollow");
  expect(externalRequests).toEqual([]);
  let externalWarning = "";
  let popups = 0;
  page.on("popup", () => {
    popups++;
  });
  page.once("dialog", async (dialog) => {
    externalWarning = dialog.message();
    await dialog.dismiss();
  });
  await content.getByRole("link", { name: "允许的链接" }).click();
  expect(externalWarning).toContain("https://example.com");
  expect(popups).toBe(0);
  expect(await page.evaluate(() => "XSS_SENTINEL" in globalThis)).toBe(false);
});
test("account can sign out every device using the CSRF-protected session endpoint", async ({
  page,
  browser,
}) => {
  const email = `${randomUUID()}@test.invalid`;
  await signIn(page, email);
  const secondContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: "https://localhost:3000",
  });
  try {
    const second = await secondContext.newPage();
    await signIn(second, email);
    expect((await second.request.get("/api/session")).status()).toBe(200);
    await page.goto("/account");
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "登出所有设备", exact: true })
      .click();
    await expect(page).toHaveURL(/\/sign-in$/);
    expect((await page.request.get("/api/session")).status()).toBe(401);
    expect((await second.request.get("/api/session")).status()).toBe(401);
  } finally {
    await secondContext.close();
  }
});
test("admin risk UI reports enforced freezes and every dashboard access is audited", async ({
  page,
}, testInfo) => {
  await signIn(page, "preview@ruwen.local");
  await page.getByRole("link", { name: "管理工作室", exact: true }).click();
  await expect(page.getByText("运行保护已接入", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "冻结与解冻审计", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "管理访问审计（最近100条）",
      exact: true,
    }),
  ).toBeVisible();
  const response = await page.request.get("/api/admin");
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.security.enforcement).toBe("active");
  expect(payload.security.audit).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ action: "dashboard_page", outcome: "allowed" }),
      expect.objectContaining({ action: "dashboard_data", outcome: "allowed" }),
    ]),
  );
  await page.screenshot({
    path: testInfo.outputPath("admin-security.png"),
    fullPage: true,
  });
});
test("real browser: register, project, paced SSE, two approvals, files/export, ownership, CSRF, mobile", async ({
  page,
  browser,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await signIn(page);
  const projectId = await createDemo(page, "北岸冬信 · 浏览器试读");
  await page.getByRole("link", { name: "进入章节写作" }).click();
  await page.getByRole("button", { name: "开始写作", exact: true }).click();
  await expect(page).toHaveURL(/\?run=/);
  const runId = new URL(page.url()).searchParams.get("run");
  await expect(page.locator(".prose-paragraph").first()).toBeVisible();
  await expect(page.locator(".manuscript-meta")).toContainText("流式草稿");
  await expect(page.getByTestId("run-status")).toHaveText("等待你阅读与批准", {
    timeout: 60000,
  });
  await expect(page.locator(".annotation").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "批准正文，生成记忆预览", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("candidate-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "编辑记录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "事实修正", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "核验结论", exact: true }).click();
  await expect(page.locator(".verdict")).toHaveCount(2);
  await page.getByLabel("我已阅读候选稿和核验结果，确认批准正文").check();
  await page
    .getByRole("button", { name: "批准正文，生成记忆预览", exact: true })
    .click();
  await expect(page.getByTestId("run-status")).toHaveText("等待批准资料变更");
  await expect(
    page.getByRole("heading", { name: "阅读资料变更，再决定是否提交。" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "批准并提交资料变更", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("我已逐项阅读资料变更预览，确认提交").check();
  await page
    .getByRole("button", { name: "批准并提交资料变更", exact: true })
    .click();
  await expect(page.getByTestId("run-status")).toHaveText("正文与资料已提交");
  const noCsrf = await page.request.post(`/api/runs/${runId}/cancel`, {
    data: {},
  });
  expect(noCsrf.status()).toBe(403);
  const download = await page.request.get(`/api/projects/${projectId}/export`);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/zip");
  expect((await download.body()).subarray(0, 2).toString()).toBe("PK");
  await page.getByRole("link", { name: "项目资料", exact: true }).click();
  await page
    .getByRole("button", { name: "chapters/chapter-001.md", exact: true })
    .click();
  await expect(page.locator(".file-content")).toContainText("林川");
  const other = await browser.newContext({ ignoreHTTPSErrors: true });
  const second = await other.newPage();
  await signIn(second);
  for (const url of [
    `/api/projects/${projectId}`,
    `/api/projects/${projectId}/files`,
    `/api/projects/${projectId}/export`,
    `/api/runs/${runId}`,
    `/api/runs/${runId}/events`,
  ])
    expect((await second.request.get(url)).status(), url).toBe(404);
  expect((await second.goto(`/projects/${projectId}`))?.status()).toBe(404);
  await other.close();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/${projectId}/chapters?run=${runId}`);
  await expect(page.locator(".manuscript")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("candidate-mobile.png"),
    fullPage: true,
  });
  expect(pageErrors).toEqual([]);
});
test("faux failure and manual return remain stopped until the user chooses another run", async ({
  page,
}) => {
  test.setTimeout(180000);
  await signIn(page);
  await createDemo(page, "退回与放弃试验");
  await page.getByRole("link", { name: "进入章节写作" }).click();
  await page.getByLabel("预览场景").selectOption("plot_fail");
  await page.getByRole("button", { name: "开始写作", exact: true }).click();
  await expect(page.getByTestId("run-status")).toHaveText(
    "已退回，等待重新构思",
    { timeout: 60000 },
  );
  await expect(page.getByText("退回原因", { exact: true })).toBeVisible();
  await page.getByLabel("预览场景").selectOption("normal");
  await page.getByRole("button", { name: "开始写作", exact: true }).click();
  await expect(page.getByTestId("run-status")).toHaveText("等待你阅读与批准", {
    timeout: 60000,
  });
  await page.getByRole("button", { name: "退回候选稿", exact: true }).click();
  await page.getByLabel("退回原因").fill("想先调整人物选择，再重写这一章。");
  await page.getByRole("button", { name: "确认退回", exact: true }).click();
  await expect(page.getByTestId("run-status")).toHaveText(
    "已退回，等待重新构思",
  );
  await page.getByRole("button", { name: "开始写作", exact: true }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "放弃本次运行", exact: true }).click();
  await expect(page.getByTestId("run-status")).toHaveText("已放弃");
});

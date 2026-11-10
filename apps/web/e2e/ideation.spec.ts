import { expect, test } from "@playwright/test";
import { createDemo, signIn } from "./helpers.ts";

test("typed demo: conversations, session switching, clean handoff, read-only close and tenant page boundary", async ({
  page,
  browser,
}, testInfo) => {
  await signIn(page);
  const projectId = await createDemo(page, "北岸来信 · 构思工作台");
  const ideationRequests: string[] = [],
    external: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/.*\/ideation/.test(request.url()))
      ideationRequests.push(request.url());
    if (request.url().includes("tracker.invalid")) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`/projects/${projectId}/ideation`);
  await expect(
    page.getByRole("heading", { name: "把想法，交还给故事。", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("交给下游的干净委托", { exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ideation-initial.png") });
  const raw =
    "PRIVATE_IDEATION_WORDING_53ef\n\n让林砚保留自己的选择。\n\n<script>globalThis.IDEATION_XSS=1</script>\n\n![追踪](https://tracker.invalid/raw)";
  await page.getByLabel("想和协调员说的话", { exact: true }).fill(raw);
  await page.getByRole("button", { name: "发送给协调员", exact: true }).click();
  const conversation = page.getByRole("region", {
    name: "协调员会话",
    exact: true,
  });
  await expect(conversation).toContainText("PRIVATE_IDEATION_WORDING_53ef");
  await expect(
    conversation.getByText(
      "我会把固定事实和仍然开放的选择分开。请先阅读右侧的理解与干净委托，再决定是否交给下游。",
      { exact: true },
    ),
  ).toBeVisible();
  const review = page.getByRole("region", {
    name: "构思预览工作台",
    exact: true,
  });
  await expect(review).not.toContainText("PRIVATE_IDEATION_WORDING_53ef");
  await expect(
    page.getByRole("region", { name: "下游任务", exact: true }),
  ).not.toContainText("PRIVATE_IDEATION_WORDING_53ef");
  expect(external).toEqual([]);
  expect(await page.evaluate(() => "IDEATION_XSS" in globalThis)).toBe(false);
  await expect(conversation.locator("img,script,iframe")).toHaveCount(0);
  await review
    .getByRole("checkbox", {
      name: "我已阅读此版本，确认这次模拟批准",
      exact: true,
    })
    .check();
  await review
    .getByRole("button", { name: "批准委托（演示）", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "实际项目文件、正典和余额均未改变",
  );
  await expect(
    page.getByText("上次模拟批准记录（非真实提交）", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("构思会话", { exact: true })
    .selectOption({ label: "渡河之前" });
  await expect(conversation).not.toContainText("PRIVATE_IDEATION_WORDING_53ef");
  await page
    .getByLabel("构思会话", { exact: true })
    .selectOption({ label: "北岸冬信" });
  await expect(conversation).toContainText("PRIVATE_IDEATION_WORDING_53ef");
  await page.getByLabel("新会话名称", { exact: true }).fill("另一条河流");
  await page.getByRole("button", { name: "新建构思会话", exact: true }).click();
  await expect(conversation).toContainText("从一个放不下的念头开始");
  page.once("dialog", (dialog) => dialog.accept());
  await conversation
    .getByRole("button", { name: "关闭会话", exact: true })
    .click();
  await expect(
    page.getByLabel("想和协调员说的话", { exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "发送给协调员", exact: true }),
  ).toBeDisabled();
  expect(ideationRequests).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("ideation-desktop.png"),
    fullPage: true,
  });
  const otherContext = await browser.newContext({
    baseURL: "https://localhost:3000",
    ignoreHTTPSErrors: true,
  });
  try {
    const other = await otherContext.newPage();
    await signIn(other);
    const response = await other.goto(`/projects/${projectId}/ideation`);
    expect(response?.status()).toBe(404);
    await expect(other.getByText("PRIVATE_IDEATION_WORDING_53ef")).toHaveCount(
      0,
    );
  } finally {
    await otherContext.close();
  }
});

test("all five preview kinds: diffs, revision confirmation, rejection, learning gate, expression activation and generation approval", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const projectId = await createDemo(page, "五种构思预览");
  await page.goto(`/projects/${projectId}/ideation`);
  const review = page.getByRole("region", {
    name: "构思预览工作台",
    exact: true,
  });
  const card = page.getByRole("article", { name: "预览详情", exact: true });
  const confirm = () =>
    card.getByRole("checkbox", {
      name: "我已阅读此版本，确认这次模拟批准",
      exact: true,
    });
  await page.getByLabel("预览类型", { exact: true }).selectOption("file_patch");
  await expect(card.getByText("当前资料", { exact: true })).toHaveCount(2);
  await expect(card).toContainText("目标文件尚不存在");
  await card
    .getByLabel("修改意见或拒绝理由", { exact: true })
    .fill("PRIVATE_REVISION_63df：请留白，不决定人物行动。");
  await card
    .getByRole("button", { name: "交回协调员修改", exact: true })
    .click();
  await expect(card).toContainText("已有新版");
  const revised = review
    .getByRole("region", { name: "预览列表", exact: true })
    .getByRole("button")
    .filter({ hasText: "版本 2" });
  await expect(revised).toHaveCount(1);
  await revised.click();
  await expect(confirm()).not.toBeChecked();
  await expect(
    card.getByRole("button", { name: "批准文件变更（演示）", exact: true }),
  ).toBeDisabled();
  await confirm().check();
  await card
    .getByRole("button", { name: "批准文件变更（演示）", exact: true })
    .click();
  await expect(card).toContainText("已模拟批准");
  await expect(card).not.toContainText("PRIVATE_REVISION_63df");
  await page
    .getByLabel("预览类型", { exact: true })
    .selectOption("learning_plan");
  await expect(card).toContainText("批准之后才进入调查");
  await confirm().check();
  await card
    .getByRole("button", { name: "批准学习计划（演示）", exact: true })
    .click();
  await expect(card).toContainText("已模拟批准");
  await page
    .getByLabel("预览类型", { exact: true })
    .selectOption("expression_candidate");
  await expect(card).toContainText("不会自动成为 active");
  await confirm().check();
  await card
    .getByRole("button", { name: "确认为候选（演示）", exact: true })
    .click();
  await review
    .getByRole("region", { name: "预览列表", exact: true })
    .getByRole("button")
    .filter({ hasText: "激活阶段" })
    .click();
  await expect(confirm()).not.toBeChecked();
  await confirm().check();
  const activate = card.getByRole("button", {
    name: "激活表现资源（演示）",
    exact: true,
  });
  await expect(activate).toBeDisabled();
  await card
    .getByRole("checkbox", { name: "我已阅读非正典试写样本", exact: true })
    .check();
  await expect(activate).toBeEnabled();
  await activate.click();
  await expect(card).toContainText("已模拟批准");
  await page
    .getByLabel("预览类型", { exact: true })
    .selectOption("generation_field");
  await expect(card).toContainText("2200 字符");
  await card
    .getByLabel("修改意见或拒绝理由", { exact: true })
    .fill("PRIVATE_REJECTION_188b：这个版本先放下。");
  await card.getByRole("button", { name: "拒绝此预览", exact: true }).click();
  await expect(card).toContainText("已拒绝");
  await page.getByLabel("编译章节", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "编译章节情境（演示）", exact: true })
    .click();
  await expect(
    review
      .getByRole("region", { name: "预览列表", exact: true })
      .getByRole("button"),
  ).toHaveCount(2);
  await review
    .getByRole("region", { name: "预览列表", exact: true })
    .getByRole("button")
    .last()
    .click();
  await expect(confirm()).not.toBeChecked();
  await confirm().check();
  await card
    .getByRole("button", { name: "批准章节情境（演示）", exact: true })
    .click();
  await expect(card).toContainText("已模拟批准");
  await page.screenshot({
    path: testInfo.outputPath("ideation-generation.png"),
    fullPage: true,
  });
});

test("pending billing/freeze errors give safe guidance and the mobile review has no horizontal overflow", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const projectId = await createDemo(page, "构思错误提示");
  await page.goto(`/projects/${projectId}/ideation`);
  await page.getByText("流式演示场景", { exact: true }).click();
  for (const [code, message] of [
    ["INSUFFICIENT_CREDITS", "余额不足"],
    ["ACCOUNT_FROZEN", "等待人工复核"],
    ["BILLING_DISABLED", "真实收费尚未开放"],
  ]) {
    await page.getByLabel("错误场景", { exact: true }).selectOption(code ?? "");
    await page
      .getByRole("button", { name: "查看错误提示", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      message ?? "",
    );
    if (code === "INSUFFICIENT_CREDITS")
      await expect(
        page
          .getByRole("main")
          .getByRole("alert")
          .getByRole("link", { name: "查看账户与点数 →", exact: true }),
      ).toHaveAttribute("href", "/account");
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("预览类型", { exact: true }).selectOption("file_patch");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("ideation-mobile.png"),
    fullPage: true,
  });
});

test("v1.1 closed session blocks new messages/revisions but keeps existing preview approval available", async ({
  page,
}) => {
  await signIn(page);
  const projectId = await createDemo(page, "关闭后的预览决定");
  await page.goto(`/projects/${projectId}/ideation`);
  const conversation = page.getByRole("region", {
    name: "协调员会话",
    exact: true,
  });
  await expect(
    page.getByText("交给下游的干净委托", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await conversation
    .getByRole("button", { name: "关闭会话", exact: true })
    .click();
  await expect(
    page.getByLabel("想和协调员说的话", { exact: true }),
  ).toBeDisabled();
  const card = page.getByRole("article", { name: "预览详情", exact: true });
  await card
    .getByLabel("修改意见或拒绝理由", { exact: true })
    .fill("关闭后不再开启协调员回合。");
  await expect(
    card.getByRole("button", { name: "交回协调员修改", exact: true }),
  ).toBeDisabled();
  await card
    .getByRole("checkbox", {
      name: "我已阅读此版本，确认这次模拟批准",
      exact: true,
    })
    .check();
  await card
    .getByRole("button", { name: "批准委托（演示）", exact: true })
    .click();
  await expect(card).toContainText("已模拟批准");
});

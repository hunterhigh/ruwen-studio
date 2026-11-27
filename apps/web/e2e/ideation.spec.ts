import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { previewConfiguration } from "../../../config/preview.ts";
import { ideationCopy as c } from "../src/copy/zh-CN.ts";
import { captureCleanup } from "./cleanup-11a.ts";
import {
  confirmAction,
  createDemoFromShelf as createDemo,
  signIn,
} from "./helpers.ts";
import { ideationHttpFixture } from "./ideation-http-fixture.ts";
import {
  approvePreviewKind,
  captureIdeation05,
  compileIdeationChapter,
  createIdeationSession,
  inbox,
  previewCard,
  selectPreviewKind,
  sessionButton,
} from "./ideation-review.ts";

test("task cancellation waits for the shared confirmation and preserves the original task endpoint", async ({
  page,
}) => {
  await signIn(page);
  const projectId = await createDemo(page, "任务取消确认");
  const fixture = await ideationHttpFixture(page, projectId);
  try {
    await page.goto(`/projects/${projectId}/ideation`);
    const strip = page.getByRole("region", { name: c.tasks, exact: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    const pills = strip.locator(".ideation-task-pills");
    await expect(pills.getByRole("button").last()).toBeVisible();
    await expect(pills).toHaveCSS("flex-wrap", "wrap");
    const layout = await pills.evaluate((row) => ({
      lines: new Set(
        Array.from(row.children, (pill) => pill.getBoundingClientRect().top),
      ).size,
      fits: row.scrollWidth <= row.clientWidth,
    }));
    expect(layout.lines).toBeGreaterThan(1);
    expect(layout.fits).toBe(true);
    await captureCleanup(page, "04");
    await strip.getByRole("button").first().click();
    const card = strip.locator("article");
    await captureIdeation05(page, "task-popover");
    const trigger = card.getByRole("button", { name: "取消任务", exact: true });
    await expect(trigger).toBeVisible();
    await confirmAction(page, trigger, "取消任务", "ideation-task");
    await expect(card).toContainText("已取消");
    await expect(trigger).toHaveCount(0);
  } finally {
    fixture.dispose();
  }
});

test("persisted conversations: switching, clean handoff, safe user Markdown, close and tenant boundaries", async ({
  page,
  browser,
}, testInfo) => {
  await signIn(page);
  const projectId = await createDemo(page, "北岸来信 · 构思工作台");
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("tracker.invalid")) external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`/projects/${projectId}/ideation`);
  const newSession = page.getByRole("button", {
    name: c.newSession,
    exact: true,
  });
  await expect(newSession).toHaveClass(/\bui-btn-secondary\b/);
  await captureCleanup(page, "05");
  await createIdeationSession(page, "北岸冬信");
  await captureIdeation05(page, "empty-session");
  const raw =
    "PRIVATE_IDEATION_WORDING_53ef\n\n让林砚保留自己的选择。\n\n<script>globalThis.IDEATION_XSS=1</script>\n\n![追踪](https://tracker.invalid/raw)";
  await page.getByLabel("想和协调员说的话", { exact: true }).fill(raw);
  await page.getByRole("button", { name: c.send, exact: true }).click();
  const conversation = page.getByRole("region", {
      name: "协调员会话",
      exact: true,
    }),
    review = page.getByRole("region", { name: "构思预览工作台", exact: true });
  await expect(conversation).toContainText("PRIVATE_IDEATION_WORDING_53ef");
  await expect(review.getByText(c.handoffHelp, { exact: true })).toBeVisible();
  await expect(review).not.toContainText("PRIVATE_IDEATION_WORDING_53ef");
  expect(external).toEqual([]);
  expect(await page.evaluate(() => "IDEATION_XSS" in globalThis)).toBe(false);
  await expect(conversation.locator("img,script,iframe")).toHaveCount(0);
  await review
    .getByRole("checkbox", {
      name: c.confirm.handoff,
      exact: true,
    })
    .check();
  await review.getByRole("button", { name: "批准委托", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("通讯门已批准");
  await expect(
    previewCard(page).getByRole("region", { name: c.receipt }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: c.tasks, exact: true }),
  ).not.toContainText("PRIVATE_IDEATION_WORDING_53ef");
  const sessions = await (
    await page.request.get(`/api/projects/${projectId}/ideation/sessions`)
  ).json();
  const firstId = sessions.value.items[0].id;
  const messages = await (
    await page.request.get(
      `/api/projects/${projectId}/ideation/sessions/${firstId}/messages`,
    )
  ).json();
  expect(
    messages.value.items.find((m: { role: string }) => m.role === "user")
      .content,
  ).toBe(raw);
  await createIdeationSession(page, "渡河之前");
  await expect(conversation).not.toContainText("PRIVATE_IDEATION_WORDING_53ef");
  await sessionButton(page, "北岸冬信").click();
  await expect(conversation).toContainText("PRIVATE_IDEATION_WORDING_53ef");
  await page.reload();
  await expect(conversation).toContainText("PRIVATE_IDEATION_WORDING_53ef");
  await createIdeationSession(page, "另一条河流");
  await expect(conversation).toContainText("从一个放不下的念头开始");
  await confirmAction(
    page,
    conversation.getByRole("button", { name: "关闭会话", exact: true }),
    "关闭会话",
    "ideation-close",
  );
  await expect(page.getByText(c.closedComposer, { exact: true })).toBeVisible();
  await expect(page.getByLabel(c.composer, { exact: true })).toHaveCount(0);
  await captureIdeation05(page, "session-closed");
  await expect(
    page.getByRole("button", { name: c.send, exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("ideation-desktop.png"),
    fullPage: true,
  });
  const otherContext = await browser.newContext({
    baseURL: previewConfiguration().baseUrl,
    ignoreHTTPSErrors: true,
  });
  try {
    const other = await otherContext.newPage();
    await signIn(other);
    for (const suffix of [
      "/sessions",
      `/sessions/${firstId}`,
      `/sessions/${firstId}/events`,
    ])
      expect(
        (
          await other.request.get(
            `/api/projects/${projectId}/ideation${suffix}`,
          )
        ).status(),
      ).toBe(404);
    expect(
      (await other.goto(`/projects/${projectId}/ideation`))?.status(),
    ).toBe(404);
    await expect(other.getByText("PRIVATE_IDEATION_WORDING_53ef")).toHaveCount(
      0,
    );
  } finally {
    await otherContext.close();
  }
});

test("preview cards preserve field mapping, revisions, rejection, trial gates and compile links", async ({
  page,
}) => {
  test.setTimeout(150000);
  await signIn(page);
  const projectId = await createDemo(page, "河谷驿站 · 决定收件箱");
  const fixture = await ideationHttpFixture(page, projectId);
  try {
    const root = `/projects/${projectId}/ideation`;
    await page.goto(root);
    const review = inbox(page);
    const card = previewCard(page);

    await selectPreviewKind(page, "handoff");
    await expect(card).toContainText(c.handoffHelp);
    await expect(card.locator(".ideation-tag")).toHaveText("故事构思师");
    await expect(card).toContainText(c.fixedFacts);
    await captureIdeation05(page, "handoff", "card");

    const patchEntry = await selectPreviewKind(page, "file_patch");
    await expect(patchEntry).toHaveAttribute("aria-current", "true");
    const patchCardId = await patchEntry.getAttribute("aria-controls");
    const expandedCard = review
      .locator(`button + [id="${patchCardId}"]`)
      .getByRole("article", {
        name: c.previewDetails,
        exact: true,
      });
    await expect(expandedCard).toBeVisible();
    const patchLink = page.url();
    await patchEntry.click();
    await expect(patchEntry).toHaveAttribute("aria-expanded", "false");
    await expect(card).toHaveCount(0);
    await expect(page).not.toHaveURL(/preview=/);
    await page.goto(patchLink);
    await expect(patchEntry).toBeInViewport();
    await expect(expandedCard).toBeVisible();
    await captureCleanup(page, "03");
    const summaries = card.locator(".ideation-patch > summary");
    await expect(summaries).toHaveCount(2);
    for (const trigger of await summaries.all()) await trigger.click();
    await expect(
      card.locator(".text-diff-line.is-added").first(),
    ).toBeVisible();
    await expect(
      card.locator(".text-diff-line.is-removed").first(),
    ).toBeVisible();
    await captureIdeation05(page, "file-patch", "card");
    await card
      .getByRole("button", { name: c.openRevision, exact: true })
      .click();
    const revision = "请给林砚留一点犹豫，暂时别替他决定是否渡河。";
    await card.getByLabel(c.revisionLabel, { exact: true }).fill(revision);
    await card
      .getByRole("button", { name: c.sendRevision, exact: true })
      .click();
    await expect(card).toContainText(c.supersededPreview);
    await card
      .getByRole("button", { name: c.newerPreview, exact: true })
      .click();
    await expect(
      card.getByRole("checkbox", { name: c.confirm.file_patch }),
    ).not.toBeChecked();
    await expect(
      card.getByRole("button", { name: c.approve.file_patch, exact: true }),
    ).toBeDisabled();
    await approvePreviewKind(page, "file_patch");
    await expect(card).not.toContainText(revision);

    await selectPreviewKind(page, "learning_plan");
    await expect(card).toContainText(c.sourceMode);
    await expect(card).toContainText(c.learningHelp);
    await captureIdeation05(page, "learning-plan", "card");
    await approvePreviewKind(page, "learning_plan");
    await captureIdeation05(page, "processed", "inbox");

    await selectPreviewKind(page, "expression_candidate");
    await expect(card).toContainText(c.candidateHelp);
    await expect(card.locator(".ideation-audit li")).toHaveCount(6);
    await captureIdeation05(page, "expression-candidate", "card");
    await approvePreviewKind(page, "expression_candidate");
    await review.getByRole("button", { name: /^待你决定 / }).click();
    const activationEntry = review
      .getByRole("region", { name: c.previewList })
      .locator('button[data-kind="expression_candidate"]')
      .filter({ hasText: c.activationStage });
    await expect(activationEntry).toBeVisible();
    if ((await activationEntry.getAttribute("aria-expanded")) !== "true")
      await activationEntry.click();
    const activation = card.getByRole("checkbox", {
      name: c.confirmActivation,
      exact: true,
    });
    await expect(activation).not.toBeChecked();
    await activation.check();
    const activate = card.getByRole("button", {
      name: c.activate,
      exact: true,
    });
    await expect(activate).toBeDisabled();
    await card
      .getByRole("checkbox", { name: c.trialRead, exact: true })
      .check();
    await expect(activate).toBeEnabled();
    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/activate-expression"),
    );
    await activate.click();
    expect((await sent).postDataJSON()).toEqual(
      expect.objectContaining({
        confirmed: true,
        trialReadConfirmed: true,
        resourceId: expect.any(String),
        expectedResourceSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(card).toContainText("已批准");
    await expect(
      review.getByRole("button", { name: c.processed, exact: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await selectPreviewKind(page, "generation_field");
    const generation = await fixture.demo.api.listPreviews({
      sessionId: fixture.demo.initialSessionId,
    });
    if (!generation.ok) throw new Error("Expected fixture previews");
    const target = generation.value.items.find(
      ({ kind, status }) => kind === "generation_field" && status === "pending",
    )?.id;
    expect(target).toBeTruthy();
    await page.goto(`${root}?preview=${target}&compile=1`);
    await expect(card).toContainText("2200 字");
    await expect(card.getByText("保持开放", { exact: true })).toHaveCount(0);
    await expect(
      review.getByRole("button", { name: c.compile, exact: true }),
    ).toHaveAttribute("aria-expanded", "true");
    await captureIdeation05(page, "compile-form");
    await review.getByRole("button", { name: c.compile, exact: true }).click();
    await captureIdeation05(page, "generation-field", "card");
    await card.getByRole("button", { name: c.reject, exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: c.rejectConfirmation.title,
    });
    const reason = "PRIVATE_REJECTION_188b：这个版本先放下。";
    await dialog.getByLabel(c.rejectReason).fill(reason);
    const rejection = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname.endsWith("/reject"),
    );
    await dialog
      .getByRole("button", { name: c.rejectConfirmation.confirmLabel })
      .click();
    expect((await rejection).postDataJSON()).toEqual(
      expect.objectContaining({
        reason,
        expectedSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    await expect(card).toContainText("已拒绝");
    await expect(card).not.toContainText("PRIVATE_REJECTION_188b");
    await compileIdeationChapter(page, "3");
    await expect(page).not.toHaveURL(/compile=1/);
    await selectPreviewKind(page, "generation_field");
    await expect(
      card.getByText(c.chapterName(3), { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole("checkbox", { name: c.confirm.generation_field }),
    ).not.toBeChecked();
    await approvePreviewKind(page, "generation_field");
    await expect(page.locator(".ideation-page")).not.toContainText(
      /\bJSON\b|cacheRead|token|\$[0-9]|版本指纹/i,
    );
  } finally {
    fixture.dispose();
  }
});

test("pending billing/freeze errors give safe guidance and the minimum desktop review has no horizontal overflow", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const projectId = await createDemo(page, "构思错误提示");
  const fixture = await ideationHttpFixture(page, projectId);
  await page.goto(`/projects/${projectId}/ideation`);
  for (const [code, message] of [
    ["INSUFFICIENT_CREDITS", "余额不足"],
    ["ACCOUNT_FROZEN", "等待人工复核"],
    ["BILLING_DISABLED", "真实收费尚未开放"],
  ] as const) {
    fixture.failNextSend(code);
    await page
      .getByLabel("想和协调员说的话", { exact: true })
      .fill("一次失败的请求");
    await page.getByRole("button", { name: c.send, exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      message,
    );
    if (code === "INSUFFICIENT_CREDITS")
      await expect(
        page
          .getByRole("main")
          .getByRole("alert")
          .getByRole("link", { name: "查看账户与点数 →", exact: true }),
      ).toHaveAttribute("href", "/account");
    if (code === "INSUFFICIENT_CREDITS") await captureIdeation05(page, "error");
  }
  await page.setViewportSize({ width: 1180, height: 900 });
  await selectPreviewKind(page, "file_patch");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("ideation-desktop.png"),
    fullPage: true,
  });
  fixture.dispose();
});

test("v1.1 closed session blocks new messages/revisions but keeps existing preview approval available", async ({
  page,
}) => {
  await signIn(page);
  const projectId = await createDemo(page, "关闭后的预览决定");
  await page.goto(`/projects/${projectId}/ideation`);
  await createIdeationSession(page, "关闭后的会话");
  await page
    .getByLabel("想和协调员说的话", { exact: true })
    .fill("用户原话独特措辞天地玄黄宇宙洪荒日月盈昃辰宿列张");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  const conversation = page.getByRole("region", {
    name: "协调员会话",
    exact: true,
  });
  await expect(page.getByText(c.handoffHelp, { exact: true })).toBeVisible();
  await confirmAction(
    page,
    conversation.getByRole("button", { name: "关闭会话", exact: true }),
    "关闭会话",
    "ideation-close",
  );
  await expect(page.getByLabel(c.composer, { exact: true })).toHaveCount(0);
  const card = page.getByRole("article", { name: "预览详情", exact: true });
  await expect(
    card.getByRole("button", { name: c.openRevision, exact: true }),
  ).toBeDisabled();
  await expect(card.getByText(c.revisionClosed)).toBeVisible();
  await card
    .getByRole("checkbox", {
      name: c.confirm.handoff,
      exact: true,
    })
    .check();
  await card.getByRole("button", { name: "批准委托", exact: true }).click();
  await expect(card).toContainText("已批准");
});

test("archive the ideation prototype over loopback HTTP", async ({ page }) => {
  test.skip(
    process.env.FRONTEND_RED05_SCREENSHOTS !== "1",
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
    const url = "http://127.0.0.1:8765/ruwen-studio-redesign.html";
    await expect
      .poll(async () => {
        try {
          return (await page.request.get(url)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto(`${url}?reference=ideation#ideation`);
    await expect(page.locator('[data-page="ideation"]')).toHaveClass(/active/);
    await captureIdeation05(page, "reference-ideation");
  } finally {
    server.kill();
  }
});

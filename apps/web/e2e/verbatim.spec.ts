import { expect, type Locator, test } from "@playwright/test";
import { previewConfiguration } from "../../../config/preview.ts";
import { createDemo, selectMessageRange, signIn } from "./helpers.ts";
import { ideationHttpFixture } from "./ideation-http-fixture.ts";

async function select(source: Locator, start: number, end: number) {
  await source.evaluate(
    (node, range) => {
      const input = node as HTMLTextAreaElement;
      input.focus();
      input.setSelectionRange(range.start, range.end);
      input.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    },
    { start, end },
  );
}
test("v1.2 typed HTTP fixture: own-message codepoint selection, both destinations, explicit approval and 600 boundary", async ({
  page,
}, info) => {
  await signIn(page);
  const projectId = await createDemo(page, "逐字保留 · 界面契约");
  const fixture = await ideationHttpFixture(page, projectId);
  await page.goto(`/projects/${projectId}/ideation`);
  const composer = page.getByLabel("想和协调员说的话", { exact: true });
  const chosen = "😀保留原句，\n 下一行。";
  await composer.fill(`序${chosen}尾`);
  await page.getByRole("button", { name: "发送给协调员", exact: true }).click();
  const source = page
    .getByLabel("你的消息原文，可选中文字", { exact: true })
    .last();
  await expect(source).toHaveValue(`序${chosen}尾`);
  const quoteRun = await fixture.addRun(fixture.demo.initialSessionId);
  const quoteStream = page.getByTestId("ideation-stream").last();
  await expect(quoteStream).toHaveCount(1);
  await fixture.emit(fixture.demo.initialSessionId, quoteRun, {
    type: "delta",
    role: "chuangyi-xietiaoyuan",
    text: `你说：“${chosen}”` as never,
  });
  await expect(quoteStream).toContainText(chosen);
  await fixture.emit(fixture.demo.initialSessionId, quoteRun, {
    type: "delta",
    role: "chuangyi-xietiaoyuan",
    text: "，我们可以保留这个感觉。" as never,
  });
  await expect(quoteStream).toContainText(
    `你说：“${chosen}”，我们可以保留这个感觉。`,
  );
  await expect(quoteStream).not.toContainText("回复已保存");
  await select(source, 1, 1 + chosen.length);
  const article = source.locator("..");
  await expect(article).toContainText(`${Array.from(chosen).length} / 600 字`);
  await article
    .getByRole("button", { name: "逐字保留到本章", exact: true })
    .click();
  const card = page.getByRole("article", { name: "预览详情", exact: true });
  await expect(card).toContainText(chosen);
  const approval = card.getByRole("button", {
    name: "批准逐字保留",
    exact: true,
  });
  await expect(approval).toBeDisabled();
  await card
    .getByRole("checkbox", {
      name: "我已阅读此版本，确认这次批准",
      exact: true,
    })
    .check();
  await approval.click();
  await expect(card.getByText("已批准", { exact: true })).toBeVisible();
  expect(fixture.verbatimRequests[0]).toMatchObject({
    start: 1,
    end: 1 + Array.from(chosen).length,
    target: { kind: "current_chapter" },
  });
  expect(Object.keys(fixture.verbatimRequests[0] ?? {}).sort()).toEqual([
    "clientRequestId",
    "end",
    "messageId",
    "start",
    "target",
  ]);
  await select(source, 1, 1 + chosen.length);
  await article
    .getByRole("button", { name: "逐字写入文件", exact: true })
    .click();
  await expect(card).toContainText("追加到文件末尾");
  await expect(
    card.getByRole("button", { name: "交回协调员修改", exact: true }),
  ).toBeDisabled();
  await card.getByRole("button", { name: "拒绝此预览", exact: true }).click();
  await expect(card.getByText("已拒绝", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".message-assistant")
      .getByRole("button", { name: "逐字保留到本章", exact: true }),
  ).toHaveCount(0);
  await composer.fill("😀".repeat(601));
  await page.getByRole("button", { name: "发送给协调员", exact: true }).click();
  const longSource = page
    .getByLabel("你的消息原文，可选中文字", { exact: true })
    .last();
  await expect(longSource).toHaveValue("😀".repeat(601));
  await select(longSource, 0, 1200);
  await expect(longSource.locator("..")).toContainText("600 / 600 字");
  await expect(
    longSource
      .locator("..")
      .getByRole("button", { name: "逐字保留到本章", exact: true }),
  ).toBeEnabled();
  await select(longSource, 0, 1202);
  await expect(longSource.locator("..")).toContainText("601 / 600 字");
  await expect(
    longSource
      .locator("..")
      .getByRole("button", { name: "逐字保留到本章", exact: true }),
  ).toBeDisabled();
  await expect(
    longSource
      .locator("..")
      .getByRole("button", { name: "逐字写入文件", exact: true }),
  ).toBeEnabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("verbatim-selection.png"),
    fullPage: true,
  });
  fixture.dispose();
});

test("persisted v1.2: Unicode user selection appends only after approval and survives reload without model admission", async ({
  page,
}) => {
  await signIn(page);
  const projectId = await createDemo(page, "逐字保留 · 真实持久化");
  const previewConfig = previewConfiguration();
  const prefix =
    previewConfig.port === 3000
      ? "ruwen"
      : `ruwen-preview-${previewConfig.port}`;
  const cookies = await page.context().cookies(previewConfig.baseUrl);
  expect(
    cookies.some(
      (c) =>
        c.name.includes(`${prefix}.`) &&
        c.secure &&
        c.httpOnly &&
        c.sameSite === "Lax",
    ),
  ).toBe(true);
  if (previewConfig.port !== 3000)
    expect(cookies.some((c) => c.name.includes("ruwen."))).toBe(false);
  await page.goto(`/projects/${projectId}/ideation`);
  await page.getByLabel("新会话名称", { exact: true }).fill("我的原句");
  await page.getByRole("button", { name: "新建构思会话", exact: true }).click();
  const chosen = "😀保留原句，\n 下一行。";
  await page
    .getByLabel("想和协调员说的话", { exact: true })
    .fill(`序${chosen}尾`);
  await page.getByRole("button", { name: "发送给协调员", exact: true }).click();
  const source = page.getByLabel("你的消息原文，可选中文字", { exact: true });
  await expect(source).toHaveValue(`序${chosen}尾`);
  await expect(
    page.getByRole("button", { name: "批准委托", exact: true }),
  ).toBeVisible();
  await selectMessageRange(source, 1, 1 + chosen.length);
  const article = source.locator("..");
  await article
    .getByLabel("逐字写入的目标文件")
    .selectOption({ label: "世界/当前态势.md" });
  const before = await (
    await page.request.get(
      `/api/projects/${projectId}/files?path=${encodeURIComponent("世界/当前态势.md")}`,
    )
  ).json();
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/verbatim-previews") && r.request().method() === "POST",
  );
  await article
    .getByRole("button", { name: "逐字写入文件", exact: true })
    .click();
  const created = await response;
  expect(created.status()).toBe(201);
  const preview = (await created.json()).value;
  expect(preview).toMatchObject({
    kind: "verbatim",
    taskId: null,
    text: chosen,
    characterCount: Array.from(chosen).length,
  });
  const card = page.getByRole("article", { name: "预览详情", exact: true });
  await expect(card).toContainText(chosen);
  await expect(
    card.getByRole("button", { name: "批准逐字保留", exact: true }),
  ).toBeDisabled();
  expect(
    (
      await (
        await page.request.get(
          `/api/projects/${projectId}/files?path=${encodeURIComponent("世界/当前态势.md")}`,
        )
      ).json()
    ).text,
  ).toBe(before.text);
  await card
    .getByRole("checkbox", {
      name: "我已阅读此版本，确认这次批准",
      exact: true,
    })
    .check();
  await card.getByRole("button", { name: "批准逐字保留", exact: true }).click();
  await expect(card.getByText("已批准", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("预览类型", { exact: true }).selectOption("verbatim");
  await expect(card.getByText("已批准", { exact: true })).toBeVisible();
  const after = await (
    await page.request.get(
      `/api/projects/${projectId}/files?path=${encodeURIComponent("世界/当前态势.md")}`,
    )
  ).json();
  expect(after.text).toBe(before.text + preview.target.separator + chosen);
  const tasks = await (
    await page.request.get(
      `/api/projects/${projectId}/ideation/sessions/${preview.sessionId}/tasks`,
    )
  ).json();
  expect(tasks.value.items).toHaveLength(1);
});

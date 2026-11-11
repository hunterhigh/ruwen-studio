import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createDemo, signIn } from "./helpers.ts";

test("account daily limit persists, refuses a chapter without accepting a task, resets and fits mobile", async ({
  page,
}) => {
  await signIn(page);
  const projectId = await createDemo(page, "每日预算试用");
  await page.goto("/account");
  const panel = page.getByRole("region", { name: "每日点数上限", exact: true });
  const input = panel.getByLabel("每日点数上限", { exact: true });
  await input.fill("1000");
  await panel
    .getByRole("button", { name: "保存每日上限", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("每日点数上限已保存");
  await page.reload();
  await expect(input).toHaveValue("1000");
  await page.goto(`/projects/${projectId}/chapters`);
  await page.getByRole("button", { name: "开始写作", exact: true }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "今日点数额度不足",
  );
  await expect(page).not.toHaveURL(/\?run=/);
  const runs = await (
    await page.request.get(`/api/projects/${projectId}/runs`)
  ).json();
  expect(runs).toHaveLength(0);
  await page.goto("/account");
  await panel
    .getByRole("button", { name: "恢复默认上限", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已恢复默认每日上限");
  const account = await (await page.request.get("/api/account")).json();
  await expect(input).toHaveValue(account.daily.sandbox.defaultLimit);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("disposable mailbox is rejected before invitation redemption or preview-mail login", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill(`${randomUUID()}@mailinator.com`);
  await page.getByLabel("如何称呼你").fill("测试");
  await page.getByLabel("邀请码").fill("RUWEN-PREVIEW");
  await page.getByRole("button", { name: "发送登录链接", exact: true }).click();
  await expect(page.locator('.error[role="alert"]')).toContainText(
    "暂不支持此邮箱服务",
  );
  await expect(
    page.getByRole("button", { name: "打开本浏览器的预览邮件", exact: true }),
  ).toHaveCount(0);
});

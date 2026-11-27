import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { runtimeSettings } from "../../../config/settings.ts";
import { captureSignIn } from "./sign-in-capture.ts";

test("sign-in sends through the preview inbox and preserves the pen name and invitation when changing email", async ({
  page,
}) => {
  const email = `reader-${randomUUID().slice(0, 8)}@test.invalid`;
  await page.goto("/sign-in");
  const submit = page.getByRole("button", {
    name: "发送登录邮件",
    exact: true,
  });
  const mailbox = page.getByRole("button", {
    name: "打开本浏览器的预览邮件",
    exact: true,
  });
  const address = page.getByLabel("邮箱", { exact: true });
  const name = page.getByLabel("笔名", { exact: false });
  const invitation = page.getByLabel("邀请码", { exact: true });
  await expect(submit).toBeEnabled();
  await expect(page.locator(".signin-cover .book-cover-label")).toHaveText(
    "如文",
  );
  await expect(page.locator(".signin-story ol li")).toHaveText([
    "和协调员聊出故事方向",
    "岗位写出候选稿并逐一审读",
    "你读完、批准，才进入正典",
  ]);
  expect(
    await page
      .locator(".signin-cover")
      .evaluate((node) => node.getBoundingClientRect().width),
  ).toBe(220);
  await expect(
    page.getByRole("button", { name: "使用 Google 登录" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: /服务条款|隐私政策/ }),
  ).toHaveCount(0);
  await captureSignIn(page, "initial");

  await address.fill("reader");
  await submit.click();
  await expect(page.locator("#signin-error-email")).toHaveText(
    "请填写完整的邮箱地址。",
  );
  await expect(address).toBeFocused();
  await address.fill(email);
  await name.fill("北窗来信");
  await invitation.fill("RUWEN-PREVIEW");
  await captureSignIn(page, "filled");
  await invitation.fill("已用完的邀请码");
  await submit.click();
  await expect(page.locator("#signin-error-invitation")).toHaveText(
    "此邀请码无效或已用完。请核对后再试。",
  );
  await expect(invitation).toHaveAttribute(
    "aria-describedby",
    "signin-error-invitation",
  );
  await captureSignIn(page, "invitation-error");

  await invitation.fill("RUWEN-PREVIEW");
  await submit.click();
  await expect(page.getByRole("status")).toContainText(email);
  await expect(address).toHaveCount(0);
  await expect(mailbox).toBeVisible();
  await captureSignIn(page, "preview-mail");
  await page.route("**/api/preview/mail", (route) =>
    route.fulfill({
      status: 404,
      json: { error: "登录邮件尚未到达或已过期。" },
    }),
  );
  await mailbox.click();
  await expect(page.locator("#signin-error-preview")).toHaveText(
    "预览邮件已过期或无法打开。请返回表单重新发送。",
  );
  await page.unroute("**/api/preview/mail");
  await page.getByRole("button", { name: "换一个邮箱", exact: true }).click();
  await expect(address).toHaveValue("");
  await expect(address).toBeFocused();
  await expect(name).toHaveValue("北窗来信");
  await expect(invitation).toHaveValue("RUWEN-PREVIEW");
  await address.fill(`other-${email}`);
  await submit.click();
  await expect(page.getByRole("status")).toContainText(`other-${email}`);
  await mailbox.click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("sign-in shows a generic or timed rate-limit hint beside the send action", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill(`limit-${randomUUID().slice(0, 8)}@test.invalid`);
  await page.getByLabel("邀请码", { exact: true }).fill("已用完的邀请码");
  const submit = page.getByRole("button", {
    name: "发送登录邮件",
    exact: true,
  });
  const alert = page.locator(".signin-submit").getByRole("alert");
  let status = 0;
  for (
    let attempt = 0;
    attempt <= runtimeSettings().security.loginEmailLimit;
    attempt++
  ) {
    const [response] = await Promise.all([
      page.waitForResponse("**/api/login"),
      submit.click(),
    ]);
    status = response.status();
    if (status === 429) {
      expect(response.headers()["retry-after"]).toBeUndefined();
      expect(await response.json()).toEqual({
        error: "登录请求过多，请稍后再试。",
      });
      break;
    }
    expect(status).toBe(400);
  }
  expect(status).toBe(429);
  await expect(alert).toHaveText("发送过于频繁。请稍后再试。");
  await captureSignIn(page, "rate-limited");
  await page.route("**/api/login", (route) =>
    route.fulfill({
      status: 429,
      headers: { "retry-after": "35" },
      json: { error: "登录请求过多，请稍后再试。" },
    }),
  );
  await submit.click();
  await expect(alert).toHaveText("发送过于频繁。请等待 35 秒后再试。");
});

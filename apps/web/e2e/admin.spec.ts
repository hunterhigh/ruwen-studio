import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { captureAdmin } from "./admin-capture.ts";
import { signIn } from "./helpers.ts";

test("non-admin routes and missing projects use the same 404 with a shelf link", async ({
  page,
}) => {
  await signIn(page);
  const title = page.getByRole("heading", {
    name: "这一页不存在",
    exact: true,
  });
  for (const [url, api] of [
    ["/admin", "/api/admin"],
    ["/admin/reservations", "/api/admin/reservations"],
  ] as const) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(title).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "运行概况", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "待核对预留", exact: true }),
    ).toHaveCount(0);
    expect((await page.request.get(api)).status()).toBe(404);
  }

  await page.goto(`/projects/${randomUUID()}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(title).toBeVisible();
  await expect(page.locator(".not-found-paper")).toContainText(
    "可能已被删除，或者你没有访问权限。",
  );
  const response = await page.goto(`/missing-${randomUUID()}`, {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(404);
  await expect(title).toBeVisible();
  await captureAdmin(page, "not-found");
  await page.getByRole("link", { name: "回到书架", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(
    page.getByRole("heading", { name: "书架", exact: true }),
  ).toBeVisible();
});

test("management errors show nearby human-facing text without internal paths", async ({
  page,
}) => {
  await signIn(page, "preview@ruwen.local");
  const internalError = "EIO at service (/srv/private/ruwen/worker.ts:11:5)";
  for (const url of [
    "**/api/admin",
    "**/api/admin/annotation-stats?*",
    "**/api/admin/reservations",
  ]) {
    await page.route(url, (route) =>
      route.fulfill({ status: 500, json: { error: internalError } }),
    );
  }
  await page.goto("/admin");
  const main = page.locator(".admin-page");
  await expect(main.getByTestId("inline-notice").getByRole("alert")).toHaveText(
    ["暂时无法读取运行概况，请重试。", "暂时无法读取意见反馈统计，请重试。"],
  );
  await expect(main.locator(".page-heading .eyebrow")).toHaveCount(0);
  await expect(main).not.toContainText(/EIO|\/srv\/private/);
  await page.goto("/admin/reservations");
  await expect(main.getByTestId("inline-notice").getByRole("alert")).toHaveText(
    "暂时无法读取待核对预留，请重试。",
  );
  await expect(main.locator(".eyebrow")).toHaveText("工作室管理 / 费用复核");
  await expect(main).not.toContainText(/EIO|\/srv\/private/);
});

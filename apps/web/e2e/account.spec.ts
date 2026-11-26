import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Database } from "@ruwen/db";
import { previewConfiguration } from "../../../config/preview.ts";
import { captureAccount } from "./account-capture.ts";
import { createDemoFromShelf, signIn } from "./helpers.ts";

test("account groups the recent usage by run and keeps billing details in points", async ({
  page,
}) => {
  const title = "北岸冬信";
  const now = Date.now();
  const first = new Date(now - 30 * 60_000);
  const second = new Date(now - 29 * 60_000);
  const unknown = new Date(now - 25 * 60_000);
  await signIn(page);
  const project = await createDemoFromShelf(page, title);
  const db = new Database(previewConfiguration().databaseUrl);

  try {
    const [completed, review] = [randomUUID(), randomUUID()];
    const owner = (
      await db.pool.query<{ owner_id: string }>(
        "SELECT owner_id FROM projects WHERE id=$1",
        [project],
      )
    ).rows[0]?.owner_id;
    if (!owner) throw new Error("Missing fixture owner");
    await db.pool.query(
      "INSERT INTO pipeline_runs(id,project_id,kind,chapter,status,request) VALUES ($1,$3,'chapter_run','2','FAILED','{}'),($2,$3,'chapter_run','3','FAILED','{}')",
      [completed, review, project],
    );
    for (const row of [
      { run: completed, role: "xiaoshuo-zuozhe", time: first, credits: 1_245 },
      { run: completed, role: "wenxue-bianji", time: second, credits: 385 },
      { run: review, role: "qinggan-duzhe", time: unknown, credits: null },
    ]) {
      const result = await db.pool.query<{ id: string }>(
        "INSERT INTO role_runs(run_id,role_id,status,model,input_sha256,started_at,usage,usage_unknown) VALUES($1,$2,'failed','faux/USD-token',$3,$4,$5,$6) RETURNING id",
        [
          row.run,
          row.role,
          "a".repeat(64),
          row.time,
          { tokenCount: 410, cached: 10, usd: 0.125 },
          row.credits === null,
        ],
      );
      if (row.credits !== null) {
        await db.pool.query(
          "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'sandbox',$2,'role_usage','role',$3)",
          [owner, -row.credits, result.rows[0]?.id],
        );
      }
    }
  } finally {
    await db.close();
  }

  await page.goto("/account");
  await expect(page.getByRole("region", { name: "正式点数" })).toContainText(
    "可用余额",
  );
  await expect(page.getByRole("region", { name: "测试点数" })).toContainText(
    "运行中预留",
  );
  await expect(page.getByText("按 UTC 日计算")).toBeVisible();
  await expect(page.getByText("显示最近 100 条记录")).toBeVisible();
  await expect(page.getByText("本月已用")).toHaveCount(0);
  const table = page.getByRole("table");
  await expect(table.getByText("注册赠送", { exact: true })).toHaveCount(2);
  await expect(table.getByRole("row")).toHaveCount(5);
  const runs = table.locator(".account-run-summary");
  await expect(runs).toHaveCount(2);
  const pending = runs.nth(0);
  const completed = runs.nth(1);
  await expect(pending).toContainText("待核对");
  await expect(completed).toContainText(`《${title}》 · `);
  await expect(completed).toContainText("1,630 点");
  await expect(completed.locator("time")).toHaveAttribute(
    "datetime",
    first.toISOString(),
  );
  await expect(table).not.toContainText(/第[二三23]章|失败/);
  await captureAccount(page, "account");

  await completed.click();
  const roles = table.locator("details[open] .account-roles");
  await expect(roles.getByText("小说作者", { exact: true })).toBeVisible();
  await expect(roles.getByText("文学编辑", { exact: true })).toBeVisible();
  await expect(roles.getByText("1,245 点", { exact: true })).toBeVisible();
  await expect(roles.getByText("385 点", { exact: true })).toBeVisible();
  await captureAccount(page, "role-usage");

  await completed.click();
  await pending.click();
  await expect(roles.getByText("待核对", { exact: true })).toBeVisible();
  await pending.click();
  await page.getByRole("button", { name: "调整每日上限" }).click();
  const limit = page.getByRole("region", { name: "每日点数上限" });
  const account = await (await page.request.get("/api/account")).json();
  await expect(limit.getByRole("spinbutton")).toHaveAttribute(
    "max",
    String(account.daily.sandbox.maximum),
  );
  await expect(limit).toContainText(
    "运行中的预留也计入当天上限。降低上限后，新的模型调用可能被拒绝。",
  );
  await captureAccount(page, "daily-limit");
});

test("account disables purchases when sandbox checkout is unavailable", async ({
  page,
}) => {
  await signIn(page);
  await page.route("**/api/account", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), sandboxEnabled: false },
    });
  });
  await page.goto("/account");
  await page.getByRole("button", { name: "购买点数", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "购买点数" });
  await expect(dialog.getByRole("alert")).toHaveText(
    "真实收费尚未开放。当前不会发起付款。",
  );
  await expect(
    dialog.getByRole("button", { name: "创建沙箱结账" }),
  ).toBeDisabled();
  await captureAccount(page, "purchase-disabled");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "购买点数", exact: true }),
  ).toBeFocused();
});

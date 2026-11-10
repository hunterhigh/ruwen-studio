import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Database } from "@ruwen/db";
import { runtimeSettings } from "../../../config/settings.ts";
import { createDemo, signIn } from "./helpers.ts";

test("sandbox purchase records a real ledger entry once and refreshes segregated balances", async ({
  page,
}, testInfo) => {
  await signIn(page);
  await page.goto("/account");
  const before = await (await page.request.get("/api/account")).json();
  await expect(
    page.getByRole("heading", { name: "余额与预留", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "购买测试点数 · 测试点数包", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "完成模拟支付", exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "完成模拟支付", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "模拟支付已记入沙箱点数账本",
  );
  const after = await (await page.request.get("/api/account")).json();
  expect(BigInt(after.banks.sandbox.balance)).toBe(
    BigInt(before.banks.sandbox.balance) +
      BigInt(runtimeSettings().billing.plans[0]?.credits ?? 0),
  );
  expect(after.banks.live).toEqual(before.banks.live);
  expect(
    after.ledger.filter(
      (entry: { reason: string }) => entry.reason === "payment",
    ),
  ).toHaveLength(1);
  expect(after.release.realChargingEnabled).toBe(false);
  await page.screenshot({
    path: testInfo.outputPath("billing-account.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("frozen run refuses without a task, and an audited administrator can unfreeze after review", async ({
  page,
  browser,
}, testInfo) => {
  const email = `${randomUUID()}@test.invalid`;
  await signIn(page, email);
  const projectId = await createDemo(page, "风控冻结浏览器测试");
  const db = new Database(
    "postgresql://ruwen:local_test_only@127.0.0.1:54329/ruwen_dev",
  );
  const adminContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: "https://localhost:3000",
  });
  try {
    const owner = (
      await db.pool.query<{ id: string }>(
        "SELECT id FROM users WHERE email=$1",
        [email],
      )
    ).rows[0]?.id;
    if (!owner) throw new Error("Missing fixture user");
    for (let n = 0; n < runtimeSettings().riskReview.freezeScore; n++)
      await db.pool.query(
        "INSERT INTO security_events(user_id,kind,score) VALUES($1,'access_denied',1)",
        [owner],
      );
    await page.goto(`/projects/${projectId}/chapters`);
    await page.getByRole("button", { name: "开始写作", exact: true }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "等待人工复核",
    );
    expect(
      (
        await db.pool.query(
          "SELECT id FROM pipeline_runs WHERE project_id=$1",
          [projectId],
        )
      ).rowCount,
    ).toBe(0);
    const admin = await adminContext.newPage();
    await signIn(admin, "preview@ruwen.local");
    await admin.goto("/admin");
    const account = admin.locator("tr").filter({ hasText: email });
    await expect(account).toContainText("已冻结");
    admin.once("dialog", (dialog) => dialog.accept());
    await account
      .getByRole("button", { name: "人工复核并解冻", exact: true })
      .click();
    await expect(account).toContainText("未冻结");
    await expect(
      account.getByRole("button", { name: "人工复核并解冻", exact: true }),
    ).toBeDisabled();
    expect(
      (
        await db.pool.query(
          "SELECT action FROM account_risk_audit WHERE user_id=$1 ORDER BY created_at",
          [owner],
        )
      ).rows.map((row) => row.action),
    ).toEqual(["freeze", "unfreeze"]);
    await admin.screenshot({
      path: testInfo.outputPath("risk-unfreeze.png"),
      fullPage: true,
    });
  } finally {
    await adminContext.close();
    await db.close();
  }
});

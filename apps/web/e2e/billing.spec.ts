import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Database } from "@ruwen/db";
import { previewConfiguration } from "../../../config/preview.ts";
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
  const db = new Database(previewConfiguration().databaseUrl);
  const adminContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: previewConfiguration().baseUrl,
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

test("admin reviews uncertain cost with a reason and the account shows the audited result", async ({
  page,
  browser,
}) => {
  const email = `${randomUUID()}@test.invalid`;
  await signIn(page, email);
  const projectId = await createDemo(page, "费用人工核对测试");
  const db = new Database(previewConfiguration().databaseUrl);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL: previewConfiguration().baseUrl,
  });
  try {
    const owner = (
      await db.pool.query<{ owner_id: string }>(
        "SELECT owner_id FROM projects WHERE id=$1",
        [projectId],
      )
    ).rows[0]?.owner_id;
    if (!owner) throw new Error("Missing fixture owner");
    const run = randomUUID(),
      settings = runtimeSettings().billing;
    await db.pool.query(
      "INSERT INTO pipeline_runs(id,project_id,kind,chapter,status,request) VALUES($1,$2,'chapter_run','1','FAILED','{}')",
      [run, projectId],
    );
    const prompt = "billing review browser fixture";
    const promptHash = createHash("sha256").update(prompt).digest("hex");
    await db.pool.query(
      "INSERT INTO prompts(sha256,content) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [promptHash, prompt],
    );
    await db.pool.query(
      "INSERT INTO role_runs(run_id,role_id,status,model,prompt_sha256,input_sha256,usage_unknown) VALUES($1,'xiaoshuo-zuozhe','failed','faux/uncertain',$2,$2,true)",
      [run, promptHash],
    );
    await db.pool.query(
      "INSERT INTO credit_reservations(user_id,run_id,bank,amount,remaining,status,cost_markup,credits_per_usd) VALUES($1,$2,'sandbox',$3,$3,'review',$4,$5)",
      [
        owner,
        run,
        settings.defaultReservations.chapter,
        settings.costMarkup,
        settings.creditsPerUsd,
      ],
    );
    await page.goto("/account");
    await expect(page.getByText(/预留折算约 USD/)).toBeVisible();
    await page.goto("/admin/reservations");
    await expect(
      page.getByRole("heading", { name: "这一页不在这里。", exact: true }),
    ).toBeVisible();
    const admin = await context.newPage();
    await signIn(admin, "preview@ruwen.local");
    await admin.goto("/admin");
    await admin.getByRole("link", { name: "处理待核对预留" }).click();
    const card = admin.locator("section").filter({
      has: admin.getByRole("heading", { name: email, exact: true }),
    });
    await card.getByLabel("运行总实际费用 USD", { exact: true }).fill("0.125");
    await card
      .getByLabel("核对理由（必填，对用户可见）")
      .fill("已按服务商测试账单核对总实际费用。");
    admin.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "确认核对并记入审计" }).click();
    await expect(
      admin.getByText("核对已完成，账本和处理理由已保存。"),
    ).toBeVisible();
    await page.goto("/account");
    await expect(
      page.getByRole("heading", { name: "预留核对结果" }),
    ).toBeVisible();
    await expect(
      page.getByText("已按服务商测试账单核对总实际费用。", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await db.pool.query(
          "SELECT v.id FROM credit_reservation_reviews v JOIN credit_reservations r ON r.id=v.reservation_id WHERE r.run_id=$1",
          [run],
        )
      ).rowCount,
    ).toBe(1);
  } finally {
    await context.close();
    await db.close();
  }
});

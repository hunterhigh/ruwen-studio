import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { Database } from "@ruwen/db";
import { realPreviewCoordinates } from "../../../config/real-preview.ts";

test.use({ baseURL: realPreviewCoordinates().baseURL });
let preview: ChildProcess;
test.beforeAll(async () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  preview = spawn(process.execPath, ["scripts/preview-real.ts", "--faux"], {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Faux rehearsal preview did not start")),
      100000,
    );
    preview.stdout?.on("data", (bytes: Buffer) => {
      if (bytes.toString().includes("DeepSeek 本机试用")) {
        clearTimeout(timer);
        resolve();
      }
    });
    preview.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Faux rehearsal preview exited"));
    });
  });
});
test.afterAll(async () => {
  if (preview?.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      preview.kill();
      reject(new Error("Preview did not stop cleanly"));
    }, 65000);
    preview.once("exit", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error("Preview stop failed"));
    });
    preview.send({ type: "ruwen-preview-stop" });
  });
});
test("human-started preview rehearsal uses a separate persistent sandbox and can complete a chapter approval route without real calls", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page
    .getByLabel("邮箱", { exact: true })
    .fill(`${randomUUID()}@test.invalid`);
  await page.getByLabel("如何称呼你").fill("真实预览演练");
  await page.getByLabel("邀请码").fill("RUWEN-PREVIEW");
  await page.getByRole("button", { name: "发送登录链接", exact: true }).click();
  await page
    .getByRole("button", { name: "打开本浏览器的预览邮件", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  const account = await (await page.request.get("/api/account")).json();
  expect(account.bank).toBe("sandbox");
  expect(account.localRealPreview).toBe(true);
  expect(account.sandboxEnabled).toBe(false);
  expect(account.release.realChargingEnabled).toBe(false);
  expect(Number(account.balance)).toBeGreaterThanOrEqual(250000);
  await page
    .getByRole("button", { name: "新建项目", exact: false })
    .first()
    .click();
  await page.getByLabel("项目名称").fill("DeepSeek 试用启动演练");
  await page.getByLabel("从哪里开始").selectOption("demo");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  const project = page.url().split("/").at(-1);
  await page.goto(`/projects/${project}/ideation`);
  await page.getByLabel("新会话名称", { exact: true }).fill("独立试用会话");
  await page.getByRole("button", { name: "新建构思会话", exact: true }).click();
  await page
    .getByLabel("想和协调员说的话", { exact: true })
    .fill("写一场渡口的艰难选择。");
  await page.getByRole("button", { name: "发送给协调员", exact: true }).click();
  const card = page.getByRole("article", { name: "预览详情", exact: true });
  const approve = async (name: string) => {
    await card
      .getByRole("checkbox", {
        name: "我已阅读此版本，确认这次批准",
        exact: true,
      })
      .check();
    await card.getByRole("button", { name, exact: true }).click();
  };
  await expect(
    card.getByText("交给下游的干净委托", { exact: true }),
  ).toBeVisible();
  await approve("批准委托");
  await page.getByLabel("预览类型", { exact: true }).selectOption("file_patch");
  await expect(
    card.getByRole("button", { name: "批准文件变更", exact: true }),
  ).toBeVisible();
  await approve("批准文件变更");
  await page.getByLabel("编译章节", { exact: true }).fill("1");
  await page.getByRole("button", { name: "编译章节情境", exact: true }).click();
  await page
    .getByLabel("预览类型", { exact: true })
    .selectOption("generation_field");
  await expect(
    card.getByRole("button", { name: "批准章节情境", exact: true }),
  ).toBeVisible();
  await approve("批准章节情境");
  await expect(card.getByText("已批准", { exact: true })).toBeVisible();
  await page.goto(`/projects/${project}/chapters`);
  await page.getByRole("button", { name: "开始写作", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "批准正文，生成记忆预览", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await page.getByRole("checkbox", { name: /我已阅读/ }).check();
  await page
    .getByRole("button", { name: "批准正文，生成记忆预览", exact: true })
    .click();
  await expect(page.getByTestId("run-status")).toHaveText("等待批准资料变更");
  await page.getByLabel("我已逐项阅读资料变更预览，确认提交").check();
  await page
    .getByRole("button", { name: "批准并提交资料变更", exact: true })
    .click();
  await expect(page.getByTestId("run-status")).toHaveText("正文与资料已提交");
  const db = new Database(realPreviewCoordinates().databaseURL);
  try {
    const banks = await db.pool.query(
      "SELECT DISTINCT r.bank FROM credit_reservations r JOIN pipeline_runs p ON p.id=r.run_id WHERE p.project_id=$1",
      [project],
    );
    expect(banks.rows).toEqual([{ bank: "sandbox" }]);
    const debits = await db.pool.query(
      "SELECT DISTINCT bank FROM credit_ledger WHERE user_id=(SELECT owner_id FROM projects WHERE id=$1) AND reason='role_usage'",
      [project],
    );
    expect(debits.rows).toEqual([{ bank: "sandbox" }]);
    const modes = await db.pool.query(
      "SELECT DISTINCT r.result->>'runtimeMode' mode FROM role_runs r JOIN pipeline_runs p ON p.id=r.run_id WHERE p.project_id=$1",
      [project],
    );
    expect(modes.rows).toEqual([{ mode: "faux" }]);
  } finally {
    await db.close();
  }
});

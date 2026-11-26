import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { Database } from "@ruwen/db";
import { realPreviewCoordinates } from "../../../config/real-preview.ts";
import { ideationCopy as c } from "../src/copy/zh-CN.ts";
import { readCandidate, startChapter } from "./chapter-review.ts";
import {
  approvePreviewKind,
  compileIdeationChapter,
  createIdeationSession,
  selectPreviewKind,
} from "./ideation-review.ts";
import { readMemory } from "./memory-review.ts";

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
  await createIdeationSession(page, "独立试用会话");
  await page
    .getByLabel("想和协调员说的话", { exact: true })
    .fill("写一场渡口的艰难选择。");
  await page.getByRole("button", { name: c.send, exact: true }).click();
  const card = page.getByRole("article", { name: "预览详情", exact: true });

  await expect(card.getByText(c.handoffHelp, { exact: true })).toBeVisible();
  await approvePreviewKind(page, "handoff");
  await selectPreviewKind(page, "file_patch");
  await expect(
    card.getByRole("button", { name: c.approve.file_patch, exact: true }),
  ).toBeVisible();
  await approvePreviewKind(page, "file_patch");
  await compileIdeationChapter(page, "1");
  await selectPreviewKind(page, "generation_field");
  await expect(
    card.getByRole("button", { name: "批准章节情境", exact: true }),
  ).toBeVisible();
  await approvePreviewKind(page, "generation_field");
  await expect(card).toContainText("已批准");
  await page.goto(`/projects/${project}/chapters`);
  await startChapter(page);
  await expect(
    page.getByRole("button", { name: "批准正文", exact: true }),
  ).toBeVisible({ timeout: 90000 });
  await readCandidate(page);
  await page.getByRole("button", { name: "批准正文", exact: true }).click();
  await expect(page.getByTestId("run-status")).toHaveText("等你批准资料变更");
  await page.getByRole("link", { name: "阅读资料变更", exact: true }).click();
  await readMemory(page);
  await page.getByRole("button", { name: "提交资料变更", exact: true }).click();
  await expect(page.getByTestId("run-status")).toHaveText("已完成");
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

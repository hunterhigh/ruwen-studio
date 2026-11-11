import { expect, test } from "@playwright/test";
import { createDemo, selectMessageRange, signIn } from "./helpers.ts";

test("persisted faux project: conversation → handoff → downstream preview → compilation → chapter → two canonical approval gates", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const projectId = await createDemo(page, "构思到正文 · 持久化全流程");
  await page.goto(`/projects/${projectId}/ideation`);
  await page.getByLabel("新会话名称", { exact: true }).fill("河谷的选择");
  await page.getByRole("button", { name: "新建构思会话", exact: true }).click();
  const raw = "这是一条仅留在会话的原始想法甲乙丙丁戊己庚辛壬癸。";
  await page.getByLabel("想和协调员说的话", { exact: true }).fill(raw);
  await page.getByRole("button", { name: "发送给协调员", exact: true }).click();
  const card = page.getByRole("article", { name: "预览详情", exact: true });
  await expect(
    card.getByText("交给下游的干净委托", { exact: true }),
  ).toBeVisible();
  const approve = async (name: string) => {
    await card
      .getByRole("checkbox", {
        name: "我已阅读此版本，确认这次批准",
        exact: true,
      })
      .check();
    await card.getByRole("button", { name, exact: true }).click();
  };
  await approve("批准委托");
  await page.getByLabel("预览类型", { exact: true }).selectOption("file_patch");
  await expect(
    card.getByRole("button", { name: "批准文件变更", exact: true }),
  ).toBeVisible();
  await approve("批准文件变更");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "协调员会话", exact: true }),
  ).toContainText(raw);
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
  await page.screenshot({
    path: testInfo.outputPath("persistent-generation.png"),
    fullPage: true,
  });
  const source = page.getByLabel("你的消息原文，可选中文字", { exact: true });
  const exact = "甲乙丙丁";
  await selectMessageRange(
    source,
    raw.indexOf(exact),
    raw.indexOf(exact) + exact.length,
  );
  await source
    .locator("..")
    .getByRole("button", { name: "逐字保留到本章", exact: true })
    .click();
  await expect(card).toContainText(exact);
  await approve("批准逐字保留");
  await expect(card.getByText("已批准", { exact: true })).toBeVisible();
  await page.goto(`/projects/${projectId}/chapters`);
  await page.getByLabel("章节号", { exact: true }).fill("1");
  await page.getByRole("button", { name: "开始写作", exact: true }).click();
  await expect(page).toHaveURL(/\?run=[a-f0-9-]+/);
  const runId = new URL(page.url()).searchParams.get("run");
  await expect(page.getByTestId("run-status")).toHaveText("等待你阅读与批准", {
    timeout: 90000,
  });
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
  const detail = await (await page.request.get(`/api/runs/${runId}`)).json();
  const file = await (
    await page.request.get(
      `/api/projects/${projectId}/files?path=${encodeURIComponent(detail.run.target)}`,
    )
  ).json();
  expect(file.text.length).toBeGreaterThan(3000);
  const memory = await (
    await page.request.get(
      `/api/projects/${projectId}/files?path=${encodeURIComponent("世界/当前态势.md")}`,
    )
  ).json();
  expect(memory.text).toContain("粮车已经离开");
  const manifest = await (
    await page.request.get(
      `/api/projects/${projectId}/files?path=${encodeURIComponent("authoring-ruwen-v5/manifests/author-manifest.json")}`,
    )
  ).json();
  expect(JSON.parse(manifest.text).user_authored_text).toBeNull();
});

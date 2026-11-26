import { expect, test } from "@playwright/test";
import { ideationCopy as c } from "../src/copy/zh-CN.ts";
import { readCandidate, startChapter } from "./chapter-review.ts";
import { createDemo, selectMessageRange, signIn } from "./helpers.ts";
import {
  approvePreviewKind,
  compileIdeationChapter,
  createIdeationSession,
  selectPreviewKind,
} from "./ideation-review.ts";
import { readMemory } from "./memory-review.ts";

test("persisted faux project: conversation → handoff → downstream preview → compilation → chapter → two canonical approval gates", async ({
  page,
}, testInfo) => {
  await signIn(page);
  const projectId = await createDemo(page, "构思到正文 · 持久化全流程");
  await page.goto(`/projects/${projectId}/ideation`);
  await createIdeationSession(page, "河谷的选择");
  const raw = "这是一条仅留在会话的原始想法甲乙丙丁戊己庚辛壬癸。";
  await page.getByLabel("想和协调员说的话", { exact: true }).fill(raw);
  await page.getByRole("button", { name: c.send, exact: true }).click();
  const card = page.getByRole("article", { name: "预览详情", exact: true });
  await expect(card.getByText(c.handoffHelp, { exact: true })).toBeVisible();

  await approvePreviewKind(page, "handoff");
  await selectPreviewKind(page, "file_patch");
  await expect(
    card.getByRole("button", { name: c.approve.file_patch, exact: true }),
  ).toBeVisible();
  await approvePreviewKind(page, "file_patch");
  await page.reload();
  await expect(
    page.getByRole("region", { name: "协调员会话", exact: true }),
  ).toContainText(raw);
  await compileIdeationChapter(page, "1");
  await selectPreviewKind(page, "generation_field");
  await expect(
    card.getByRole("button", { name: "批准章节情境", exact: true }),
  ).toBeVisible();
  await approvePreviewKind(page, "generation_field");
  await expect(card).toContainText("已批准");
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
  await approvePreviewKind(page, "verbatim");
  await expect(card).toContainText("已批准");
  await page.goto(`/projects/${projectId}/chapters`);
  await startChapter(page);
  await expect(page).toHaveURL(/\?run=[a-f0-9-]+/);
  const runId = new URL(page.url()).searchParams.get("run");
  await expect(page.getByTestId("run-status")).toHaveText("等你阅读与批准", {
    timeout: 90000,
  });
  await readCandidate(page);
  await page.getByRole("button", { name: "批准正文", exact: true }).click();
  await expect(page.getByTestId("run-status")).toHaveText("等你批准资料变更");
  await page.getByRole("link", { name: "阅读资料变更", exact: true }).click();
  await readMemory(page);
  await page.getByRole("button", { name: "提交资料变更", exact: true }).click();
  await expect(page.getByTestId("run-status")).toHaveText("已完成");
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

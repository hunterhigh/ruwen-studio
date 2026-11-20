import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { Annotation } from "@ruwen/db";
import { createDemo, signIn } from "./helpers.ts";

test("读者意见独立记录，管理后台可以按岗位和日期查看反馈", async ({ page }) => {
  await signIn(page, "preview@ruwen.local");
  const project = await createDemo(page, "意见反馈");
  const token = (await (await page.request.get("/api/csrf")).json())
    .token as string;
  const headers = { origin: new URL(page.url()).origin, "x-csrf-token": token };
  const launch = await page.request.post(`/api/projects/${project}/chapters`, {
    headers,
    data: { chapter: 1 },
  });
  expect(launch.status()).toBe(202);
  const { id } = await launch.json();
  const url = `/api/runs/${id}`;
  const detail = async () => (await page.request.get(url)).json();
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 45000 })
    .toBe("AWAITING_CANDIDATE_APPROVAL");
  const { annotations, run } = await detail();
  const reader = (annotations as Annotation[]).filter(
    ({ kind }) => kind === "reader",
  );
  expect(reader).toHaveLength(3);
  expect((await detail()).annotations).toEqual(annotations);
  const update = (annotation: Annotation, data: unknown) =>
    page.request.put(`${url}/annotations/${annotation.id}`, { headers, data });
  const [first, second] = reader;
  if (!first || !second) throw new Error("Missing reader observations");
  expect(
    (
      await update(first, { status: "accepted", usefulness: "useful" })
    ).status(),
  ).toBe(200);
  expect(
    (
      await update(second, { status: "dismissed", usefulness: "not_useful" })
    ).status(),
  ).toBe(200);
  expect((await detail()).annotations).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: first.id,
        status: "accepted",
        usefulness: "useful",
      }),
      expect.objectContaining({
        id: second.id,
        status: "dismissed",
        usefulness: "not_useful",
      }),
    ]),
  );

  const unknown = `${randomUUID()}:0`;
  const invalid = await page.request.post(`${url}/candidate/revisions`, {
    headers,
    data: {
      baseSha256: run.candidateSha256,
      op: "revert_editor_edits",
      editIds: [unknown],
    },
  });
  expect(invalid.status()).toBe(409);
  expect(await invalid.json()).toEqual({
    error: "这处已被改动，请在修改模式里手动处理",
    editIds: [unknown],
  });
  expect((await detail()).run.candidateSha256).toBe(run.candidateSha256);

  await page.goto("/admin");
  const table = page.getByRole("table", { name: "意见反馈统计" });
  const row = table.getByRole("row", { name: /情感读者/ });
  await expect(row.getByRole("cell").nth(3)).toHaveText("50%");
  await expect(row.getByRole("cell").nth(4)).toHaveText("50%");
  if (process.env.BORROW_F_SCREENSHOTS === "1") {
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByText(/用户 \d+ · 项目 \d+/)).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const directory = new URL(
      "../../../docs/reports/borrow/F/",
      import.meta.url,
    );
    await mkdir(directory, { recursive: true });
    await page.screenshot({
      path: fileURLToPath(new URL("admin-annotation-feedback.png", directory)),
    });
  }
  await page.getByLabel("开始日期").fill("2000-01-01");
  await page.getByLabel("结束日期").fill("2000-01-02");
  await page.getByRole("button", { name: "更新统计" }).click();
  await expect(row.getByRole("cell").nth(0)).toHaveText("0");
  await expect(row.getByRole("cell").nth(3)).toHaveText("—");
});

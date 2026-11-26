import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { createDemoFromShelf, signIn } from "./helpers.ts";

test.use({ viewport: { width: 1440, height: 900 } });

async function captureShelf(page: Page, name: string) {
  if (process.env.FRONTEND_RED07_SCREENSHOTS !== "1") return;
  await page.evaluate(() => document.fonts.ready);
  const directory = new URL(
    "../../../docs/reports/frontend-redesign/07/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, directory)),
    animations: "disabled",
  });
}

async function chooseZip(
  page: Page,
  action: "导入 ZIP" | "重新选择",
  buffer: Buffer,
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: action, exact: true }).first().click();
  await (await chooser).setFiles({
    name: "旧城手稿.zip",
    mimeType: "application/zip",
    buffer,
  });
}

test("书架按创建时间排列，展示真实待批准角标，并支持筛选和搜索", async ({
  page,
}) => {
  await signIn(page);
  const { token } = await (await page.request.get("/api/csrf")).json();
  const headers = { origin: new URL(page.url()).origin, "x-csrf-token": token };
  for (const title of ["长夜渡口", "春日旅行手记", "海雾中的第七封来信"]) {
    expect(
      (
        await page.request.post("/api/projects", {
          headers,
          data: { title, mode: "blank" },
        })
      ).status(),
    ).toBe(201);
  }
  const project = await createDemoFromShelf(page, "河谷驿站");
  const launch = await page.request.post(`/api/projects/${project}/chapters`, {
    headers,
    data: { chapter: 1 },
  });
  expect(launch.status()).toBe(202);
  const { id } = await launch.json();
  await expect
    .poll(
      async () => {
        const detail = await (await page.request.get(`/api/runs/${id}`)).json();
        return detail.run.status;
      },
      { timeout: 60000 },
    )
    .toBe("AWAITING_CANDIDATE_APPROVAL");
  expect(
    (
      await page.request.post("/api/projects", {
        headers,
        data: { title: "北岸冬信", mode: "blank" },
      })
    ).status(),
  ).toBe(201);

  await page.goto("/projects");
  const shelf = page.locator(".shelf-page");
  const books = shelf.getByRole("list", { name: "书架" });
  const cover = books.locator(".book-cover");
  await expect(books.locator(".shelf-book-title")).toHaveText([
    "北岸冬信",
    "河谷驿站",
    "海雾中的第七封来信",
    "春日旅行手记",
    "长夜渡口",
    "新建项目",
  ]);
  await expect(books.locator(".shelf-badge")).toHaveText("1");
  await expect(books.locator(".shelf-book-status")).toHaveText(
    "1 份章节待批准",
  );
  await expect(books.locator("time").first()).toHaveText(
    /^创建于 \d{4}-\d{2}-\d{2}$/,
  );
  await expect(books.locator(".book-cover-label").nth(2)).toHaveText(
    "海雾中的第七封来…",
  );
  await expect(cover.first()).toHaveClass(/^book-cover cover-[0-5]$/);
  const color = await cover.first().getAttribute("class");
  await expect(shelf.locator("img, [style]")).toHaveCount(0);
  await expect(shelf.getByText("有 1 份章节等你批准")).toBeVisible();
  const process = shelf.getByRole("link", { name: "去处理" });
  await expect(process).toHaveAttribute("href", `/projects/${project}`);
  await expect(shelf.getByText("演示", { exact: true })).toHaveCount(0);
  await captureShelf(page, "shelf");

  const filter = shelf.getByRole("group", { name: "筛选项目" });
  await expect(filter.getByRole("button")).toHaveText(["全部", "有章节待批准"]);
  const pending = filter.getByRole("button", { name: "有章节待批准" });
  await pending.click();
  await expect(pending).toHaveAttribute("aria-pressed", "true");
  await expect(books.getByRole("listitem")).toHaveCount(1);
  await captureShelf(page, "filter-pending");

  const search = shelf.getByRole("searchbox", { name: "搜索书名" });
  await search.fill("河谷");
  await expect(books.getByRole("listitem")).toHaveCount(1);
  await search.fill("  北岸  ");
  await expect(shelf.getByText("没有符合条件的项目。")).toBeVisible();
  await filter.getByRole("button", { name: "全部" }).click();
  await expect(books.getByRole("listitem")).toHaveCount(1);
  await expect(cover.first()).toHaveClass(color ?? "");
  await search.fill("找不到的书名");
  await expect(books).toHaveCount(0);
  await expect(shelf.getByText("没有符合条件的项目。")).toBeVisible();
  await captureShelf(page, "search-no-results");
  await process.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project}$`));
});

test("空书架可以打开新建对话框，取消并重试后创建空白项目", async ({ page }) => {
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "书架还空着。" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "去处理" })).toHaveCount(0);
  await captureShelf(page, "empty-shelf");

  const open = page
    .getByRole("button", { name: "新建项目", exact: true })
    .last();
  await open.click();
  const dialog = page.getByRole("dialog", { name: "新建项目" });
  const title = dialog.getByRole("textbox", { name: "书名", exact: true });
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute("maxlength", "100");
  await expect(dialog.getByRole("radio", { name: /^空白项目/ })).toBeChecked();
  await captureShelf(page, "create-project");
  await title.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.click();
  await title.fill("北岸冬信");

  const create = dialog.getByRole("button", { name: "创建项目" });
  await page.route(
    "**/api/projects",
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({ status: 400, json: { error: "请核对书名。" } });
    },
    { times: 1 },
  );
  await create.click();
  await expect(dialog.getByRole("alert")).toHaveText("请核对书名。");
  await expect(title).toHaveValue("北岸冬信");
  await create.click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
});

test("ZIP 导入显示进度和服务端错误，重新选择同名 ZIP 后导入成功", async ({
  page,
}) => {
  await signIn(page);
  const original = await createDemoFromShelf(page, "旧城手稿");
  const archive = await page.request.get(`/api/projects/${original}/export`);
  expect(archive.ok()).toBeTruthy();
  await page.goto("/projects");

  const endpoint = "**/api/projects/import?*";
  let finishUpload: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  await page.route(
    endpoint,
    async (route) => {
      await gate;
      await route.continue();
    },
    { times: 1 },
  );
  const failed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/projects/import",
  );
  const broken = Buffer.from("invalid zip");
  try {
    await chooseZip(page, "导入 ZIP", broken);
    const progress = page.getByRole("dialog", {
      name: "正在导入《旧城手稿.zip》",
    });
    await expect(progress.getByRole("progressbar")).toBeVisible();
    await progress.press("Escape");
    await expect(progress).toBeVisible();
    await captureShelf(page, "importing");
  } finally {
    finishUpload?.();
  }
  const response = await failed;
  expect(response.ok()).toBe(false);
  const { error } = await response.json();
  expect(error).toMatch(/[\u4e00-\u9fff]/);
  const dialog = page.getByRole("dialog", { name: "导入失败" });
  await expect(dialog.getByRole("alert")).toHaveText(error);
  await captureShelf(page, "import-failed");

  await page.route(
    endpoint,
    (route) =>
      route.fulfill({
        status: 400,
        json: { error: {} },
      }),
    { times: 1 },
  );
  await chooseZip(page, "重新选择", broken);
  await expect(dialog.getByRole("alert")).toHaveText(
    "导入没有完成，请确认这是如文导出的 ZIP",
  );

  await chooseZip(page, "重新选择", await archive.body());
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  expect(page.url()).not.toContain(original);
  await expect(
    page.getByRole("heading", { name: "项目资料已就绪" }),
  ).toBeVisible();
});

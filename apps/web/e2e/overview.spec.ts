import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { overviewCopy as c, ideationCopy } from "../src/copy/zh-CN.ts";
import {
  decisionRefreshAfter,
  readCandidate,
  startChapter,
} from "./chapter-review.ts";
import { captureCleanup } from "./cleanup-11a.ts";
import { createDemoFromShelf, signIn } from "./helpers.ts";
import { ideationHttpFixture } from "./ideation-http-fixture.ts";
import { readMemory } from "./memory-review.ts";

function currentStep(page: Page) {
  return page.locator('.overview-steps [aria-current="step"]');
}
function decisions(page: Page) {
  return page.getByRole("region", { name: c.decisions, exact: true });
}
async function capture(page: Page, name: string) {
  if (process.env.FRONTEND_RED06_SCREENSHOTS !== "1") return;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
  const directory = new URL(
    "../../../docs/reports/frontend-redesign/06/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, directory)),
    animations: "disabled",
  });
}

test("overview explains missing materials, filters the chapter table and opens chapter compilation", async ({
  page,
}) => {
  await signIn(page);
  await page
    .getByRole("button", { name: "新建项目", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "新建项目" });
  await dialog
    .getByRole("textbox", { name: "书名", exact: true })
    .fill("送信人 · 未开篇");
  await dialog.getByRole("radio", { name: /^空白项目/ }).check();
  await dialog.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  await expect(currentStep(page)).toContainText(c.steps[0].title);
  await expect(
    page.getByRole("heading", { name: c.beforeFirstChapter }),
  ).toBeVisible();
  await expect(decisions(page)).toContainText(c.emptyDecisions);
  await capture(page, "blank-project");

  const root = new URL(page.url()).pathname;
  const materials = page.getByRole("region", { name: c.readinessHeading });
  const readiness = (await (await page.request.get(`/api${root}`)).json()) as {
    readiness: { errors: string[] };
  };
  expect(readiness.readiness.errors.length).toBeGreaterThan(5);
  const firstChecks = materials.locator(":scope > .overview-checks > li");
  await expect(firstChecks).toHaveCount(5);
  const extra = materials.locator("details").filter({
    has: page.getByText(
      `展开其余 ${readiness.readiness.errors.length - 5} 项`,
      {
        exact: true,
      },
    ),
  });
  await expect(extra.locator("summary").first()).toBeVisible();
  await expect(extra.locator("li").first()).toBeHidden();
  await materials.scrollIntoViewIfNeeded();
  await captureCleanup(page, "09");
  await extra.locator("summary").first().click();
  await expect(extra.locator("li").first()).toBeVisible();
  let errors = [
    "必需资料仍含初始化占位：项目/项目章程.md",
    "必需资源尚未批准并激活：zhujue-pov-jingtou",
    "补充检查：北岸事项仍需核对",
  ];
  await page.route(`**/api${root}`, (route) =>
    route.fulfill({ json: { readiness: { ready: false, errors } } }),
  );
  const time = new Date().toISOString();
  const row = { kind: "chapter_run", chapter: "1", created_at: time };
  await page.route(`**/api${root}/runs`, (route) =>
    route.fulfill({
      json: [
        {
          ...row,
          id: "compile",
          kind: "ideation_compile",
          chapter: "17",
          status: "SUCCEEDED",
        },
        { ...row, id: "latest", status: "REQUESTED" },
        { ...row, id: "old", status: "RETURNED" },
        { ...row, id: "empty", chapter: null, status: "DONE" },
      ],
    }),
  );
  await page.route("**/api/runs/latest", (route) =>
    route.fulfill({
      json: { prose: "# 第 1 章 · 渡口留信\n\n一盏灯还亮着。" },
    }),
  );
  await page.reload();
  await expect(currentStep(page)).toContainText(c.steps[0].title);
  await expect(materials).toContainText("项目章程仍有待补写的占位内容。");
  await expect(materials).toContainText("主角视角镜头还在等你批准并启用。");
  const diagnostic = materials.getByText(errors[2] ?? "", { exact: true });
  await expect(diagnostic).toBeHidden();
  const tables = page.getByRole("region", { name: c.chapters, exact: true });
  await expect(tables.getByRole("table")).toHaveCount(1);
  await expect(
    tables.getByRole("link", { name: "第 1 章 · 渡口留信" }),
  ).toBeVisible();
  await expect(tables).not.toContainText(
    /REQUESTED|RETURNED|SUCCEEDED|第 17 章/,
  );
  await expect(tables.getByRole("link")).toHaveCount(1);
  await capture(page, "incomplete-materials");
  await materials.getByText(c.otherChecks, { exact: true }).click();
  await expect(diagnostic).toBeVisible();
  await tables.getByText(c.allRuns, { exact: true }).click();
  const old = tables.getByRole("table", { name: c.olderRuns });
  await expect(old).toContainText("已退回");
  await expect(old.getByRole("link")).toHaveAttribute(
    "href",
    `${root}/chapters?run=old`,
  );

  errors = ["Narrative projection is stale"];
  await page.reload();
  await expect(currentStep(page)).toContainText(c.steps[1].title);
  const compile = currentStep(page).getByRole("link", {
    name: c.actions.compile,
  });
  await expect(compile).toHaveAttribute("href", `${root}/ideation?compile=1`);
  await compile.click();
  await expect(
    page.getByRole("spinbutton", {
      name: ideationCopy.compileChapter,
      exact: true,
    }),
  ).toBeVisible();
});

test("overview links a real chapter from candidate approval through memory submission and completion", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await signIn(page);
  const id = await createDemoFromShelf(page, "北岸冬信 · 审稿与记忆");
  const root = `/projects/${id}`;
  const openOverview = async () => {
    await page
      .getByRole("navigation", { name: "项目导航", exact: true })
      .getByRole("link", { name: "概览", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`${root}$`));
  };
  await page.getByRole("link", { name: c.openWriting, exact: true }).click();
  await startChapter(page);
  await expect(page.getByTestId("run-status")).toHaveText("等你阅读与批准", {
    timeout: 90_000,
  });
  const runId = new URL(page.url()).searchParams.get("run");
  expect(runId).toBeTruthy();

  await openOverview();
  await expect(currentStep(page)).toContainText(c.steps[3].title);
  const candidate = decisions(page).getByRole("link", { name: /候选稿/ });
  await expect(candidate).toHaveAttribute(
    "href",
    `${root}/chapters?run=${runId}`,
  );
  await expect(
    page.getByRole("region", { name: c.chapters, exact: true }),
  ).toContainText("等你阅读与批准");
  await capture(page, "candidate-approval");
  await candidate.click();
  await readCandidate(page);
  const candidateRefresh = decisionRefreshAfter(page, "approve-candidate");
  await page.getByRole("button", { name: "批准正文", exact: true }).click();
  await candidateRefresh;
  await expect(page.getByTestId("run-status")).toHaveText("等你批准资料变更");

  await openOverview();
  await expect(currentStep(page)).toContainText(c.steps[4].title);
  const memory = decisions(page).getByRole("link", {
    name: /资料变更（章节）/,
  });
  await expect(memory).toHaveAttribute(
    "href",
    `${root}/chapters?run=${runId}&view=memory`,
  );
  await capture(page, "memory-approval");
  await memory.click();
  await readMemory(page);
  const memoryRefresh = decisionRefreshAfter(page, "approve-memory");
  await page.getByRole("button", { name: "提交资料变更", exact: true }).click();
  await memoryRefresh;
  await expect(page.getByTestId("run-status")).toHaveText("已完成");

  await openOverview();
  await expect(
    page.locator('.overview-steps [data-step-state="done"]'),
  ).toHaveCount(5);
  await expect(decisions(page)).toContainText(c.emptyDecisions);
  const next = page.getByRole("button", { name: c.actions.next, exact: true });
  await expect(next).toBeEnabled();
  await capture(page, "completed");
  await next.click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("spinbutton", { name: "章节号", exact: true }),
  ).toHaveValue("2");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(next).toBeFocused();

  await page.route(`**/api${root}/chapters`, (route) =>
    route.fulfill({
      status: 412,
      json: {
        error: { code: "FAILED_PRECONDITION", message: "章节情境未就绪" },
      },
    }),
  );
  await next.click();
  const start = page.getByRole("dialog");
  const requested = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === `/api${root}/chapters`,
  );
  await start.getByRole("button", { name: "开始写作", exact: true }).click();
  expect((await requested).postDataJSON()).toEqual({
    chapter: "2",
    simulation: "normal",
  });
  await expect(
    start.getByRole("link", { name: c.actions.compile, exact: true }),
  ).toHaveAttribute("href", `${root}/ideation?compile=1`);
});

test("overview uses pending ideation items from the shared decisions provider", async ({
  page,
}) => {
  await signIn(page);
  const id = await createDemoFromShelf(page, "北岸驿站 · 概览决定");
  const fixture = await ideationHttpFixture(page, id);
  try {
    await page.reload();
    const row = decisions(page).getByRole("link", { name: /学习计划/ });
    await expect(row).toBeVisible();
    const href = await row.getAttribute("href");
    const query = new URL(href ?? "", page.url()).searchParams;
    expect(query.get("session")).toBe(fixture.demo.initialSessionId);
    expect(query.get("preview")).toBeTruthy();
    await row.click();
    await expect(page).toHaveURL(/preview=/);
    const card = page.getByRole("article", {
      name: ideationCopy.previewDetails,
    });
    await expect(card).toContainText("调查计划");
  } finally {
    fixture.dispose();
  }
});

test("archive the overview prototype over loopback HTTP", async ({ page }) => {
  test.skip(
    process.env.FRONTEND_RED06_SCREENSHOTS !== "1",
    "Local report evidence only",
  );
  const server = spawn(
    "python",
    [
      "-m",
      "http.server",
      "8765",
      "--bind",
      "127.0.0.1",
      "--directory",
      "docs/design",
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      windowsHide: true,
      stdio: "ignore",
    },
  );
  try {
    const url = "http://127.0.0.1:8765/ruwen-studio-redesign.html";
    await expect
      .poll(async () => {
        try {
          return (await page.request.get(url)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto(`${url}#overview`);
    await expect(page.locator('[data-page="overview"]')).toHaveClass(/active/);
    await capture(page, "reference-overview");
  } finally {
    server.kill();
  }
});

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import type { RunStatus } from "@ruwen/pipeline";
import { createDemo, signIn } from "./helpers.ts";
import { captureMemory, readMemory } from "./memory-review.ts";

const memoryFiles = [
  {
    path: "世界/当前态势.md",
    before: "## 驿站\n院门还开着。旧车停在檐下。\n\n渡口没人。\n\n天色尚早。",
    after: "## 驿站\n院门还开着。粮车已走。\n\n渡口没人。\n\n天色尚早。",
  },
];
const prose = "第一章　驿站\n\n林川把信收到衣襟里。";
const reason = "这段行程的起点尚未成立。";

test("a new memory hash resets reads and an empty preview accepts explicit confirmation", async ({
  page,
}) => {
  await signIn(page);
  const project = await createDemo(page, "资料提交 · 变更预览");
  const run = randomUUID();
  const api = `/api/runs/${run}`;
  const desk = `/projects/${project}/chapters`;
  let status: RunStatus = "AWAITING_MEMORY_APPROVAL";
  let hash = "a".repeat(64);
  let files = memoryFiles;
  await page.route(`**/api/projects/${project}/runs`, (route) =>
    route.fulfill({
      json: [{ id: run, kind: "chapter_run", chapter: "001", status }],
    }),
  );
  await page.route(`**${api}/events`, (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: "retry: 350\nid: 1\nevent: status\ndata: {}\n\n",
    }),
  );
  await page.route(`**${api}`, (route) =>
    route.fulfill({
      json: {
        run: {
          chapter: "001",
          status,
          candidateSha256: "c".repeat(64),
          memoryPreviewSha256: hash,
          events: [],
        },
        reports: {
          "jiyi-weihuyuan": {
            output: {
              new_facts: ["粮车已走。"],
              state_changes: [],
              invalidated: [],
              scope_changes: ["故事弧推进。"],
              next_chapter_state: "林川仍在候马。",
            },
          },
        },
        roles: [],
        prose,
        original: "",
        memoryFiles: files,
        memoryPreview: "原始预览不参与前端展示",
      },
    }),
  );
  await page.route(`**${api}/approve-memory`, (route) => {
    expect(route.request().postDataJSON()).toEqual({
      confirmed: true,
      expectedSha256: hash,
    });
    status = "DONE";
    return route.fulfill({ status: 202, json: {} });
  });

  await page.goto(`${desk}?view=memory`);
  await expect(page.getByRole("heading", { name: "作用域变化" })).toBeVisible();
  await expect(page.getByText("故事弧推进。")).toBeVisible();
  await expect(page.getByText("原始预览不参与前端展示")).toHaveCount(0);
  const fold = page.getByText("未改动 2 段，点击展开");
  await expect(page.getByText("渡口没人。")).not.toBeVisible();
  await fold.click();
  await expect(page.getByText("渡口没人。")).toBeVisible();
  await expect(page.getByText(hash, { exact: true })).not.toBeVisible();
  await page.getByText("技术信息", { exact: true }).click();
  await expect(page.getByText(hash, { exact: true })).toBeVisible();
  await page.getByText("技术信息", { exact: true }).click();
  await readMemory(page);
  await expect(page.getByText("林川仍在候马。")).toBeVisible();

  hash = "b".repeat(64);
  await expect(page.getByText("预览已更新，请重新阅读")).toBeVisible();
  await expect(page.getByText("已阅 0 / 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "已阅", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "提交资料变更", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "放弃本次运行", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "放弃本次运行？" });
  await expect(
    dialog.getByText("已批准的正文不会撤销，资料变更不会提交。"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  files = [];
  await page.goto(desk);
  await expect(
    page.getByText("这次没有资料需要变更", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/共 0 项/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "确认，无需变更" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "阅读资料变更", exact: true }),
  ).toHaveAttribute("href", `${desk}?run=${run}&view=memory`);
  await page.goto(`${desk}?view=memory`);
  await expect(
    page.getByText("这次没有资料需要变更", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".memory-file-row")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "已阅", exact: true }),
  ).toHaveCount(0);
  const confirm = page.getByRole("button", { name: "确认，无需变更" });
  await expect(confirm).toBeEnabled();
  await captureMemory(page, "empty");
  await confirm.click();
  await expect(page.getByTestId("run-status")).toHaveText("已完成");
});

test("chapter review fixes missing role records, repeated editor reasons and a long sidebar email", async ({
  page,
}) => {
  const email =
    "ruwen-chapter-review-long-address-for-sidebar-check@preview.test.invalid";
  await signIn(page, email);
  const project = await createDemo(page, "审稿桌 · 遗留核对");
  const run = randomUUID();
  const desk = `/projects/${project}/chapters`;
  let status: RunStatus = "AWAITING_CANDIDATE_APPROVAL";
  let decision = "RESTAGE";
  await page.route(`**/api/projects/${project}/runs`, (route) =>
    route.fulfill({
      json: [{ id: run, kind: "chapter_run", chapter: "001", status }],
    }),
  );
  await page.route(`**/api/runs/${run}/events`, (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: "event: heartbeat\ndata: {}\n\n",
    }),
  );
  await page.route(`**/api/runs/${run}`, (route) =>
    route.fulfill({
      json: {
        run: {
          chapter: "001",
          status,
          candidateSha256: "c".repeat(64),
          returnReason: status === "RETURNED" ? reason : undefined,
          events: status === "RETURNED" ? [{ status: "EDITOR_DONE" }] : [],
        },
        reports:
          status === "RETURNED"
            ? {
                "wenxue-bianji": {
                  output: { decision, return_reason: reason, edits: [] },
                },
              }
            : {},
        roles: [],
        prose,
        original: "",
        memoryFiles: [],
      },
    }),
  );
  await page.goto(desk);
  const completed = page.locator(".chapter-roles .is-done");
  await expect(completed).toHaveCount(5);
  await expect(completed.getByText("用量见账户页")).toHaveCount(5);
  await captureMemory(page, "legacy-roles");
  await page.goto("/projects");
  const address = page.locator(".sidebar-email");
  await expect(address).toHaveAttribute("title", email);
  expect(
    await address.evaluate((item) => {
      const style = getComputedStyle(item);
      return (
        style.whiteSpace === "nowrap" &&
        style.textOverflow === "ellipsis" &&
        item.scrollWidth > item.clientWidth
      );
    }),
  ).toBe(true);
  await captureMemory(page, "legacy-email");

  status = "RETURNED";
  for (const [value, label] of [
    ["RESTAGE", "需要重写"],
    ["RETURN_CONSTRUCTION", "退回构思"],
  ] as const) {
    decision = value;
    await page.goto(desk);
    await expect(page.locator(".chapter-edit-decision")).toHaveText(label);
    await expect(page.getByText(reason, { exact: true })).toHaveCount(1);
    if (value === "RESTAGE") await captureMemory(page, "legacy-editor");
  }
});

test("archive the memory prototype over loopback HTTP", async ({ page }) => {
  test.skip(
    process.env.FRONTEND_RED04_SCREENSHOTS !== "1",
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
    const url = "http://127.0.0.1:8765/ruwen-studio-redesign.html#memory";
    await expect
      .poll(async () => {
        try {
          return (await page.request.get(url)).status();
        } catch {
          return 0;
        }
      })
      .toBe(200);
    await page.goto(url);
    await expect(page.locator('[data-page="memory"]')).toHaveClass(/active/);
    await captureMemory(page, "reference-memory");
  } finally {
    server.kill("SIGTERM");
  }
});

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { annotationCopy, chapterCopy, runStatus } from "../src/copy/zh-CN.ts";
import { captureChapter, startChapter } from "./chapter-review.ts";
import { createDemo, signIn } from "./helpers.ts";

const scenarios = [
  ["restage", "RETURNED", "需要重写"],
  ["plot_fail", "RETURNED", "顺序不对"],
  ["reality_fail", "RETURNED", "制度"],
  ["length", "FAILED", chapterCopy.truncated],
  ["anchor_missing", "FAILED", chapterCopy.invalidEdit],
] as const;
for (const [scenario, status, message] of scenarios) {
  test(`chapter review handles faux ${scenario} without approval or automatic rerun`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    const id = await createDemo(page, "河谷驿站");
    await page.goto(`/projects/${id}/chapters`);
    if (scenario === "restage") {
      await expect(
        page.getByRole("heading", { name: chapterCopy.empty }),
      ).toBeVisible();
      await captureChapter(page, "empty");
    }
    await startChapter(page, scenario);
    await expect(page.getByTestId("run-status")).toHaveText(runStatus[status], {
      timeout: 90000,
    });
    await expect(
      page.getByText(message, { exact: scenario !== "restage" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: chapterCopy.approve, exact: true }),
    ).toHaveCount(0);
    const runs = await (
      await page.request.get(`/api/projects/${id}/runs`)
    ).json();
    expect(
      runs.filter((run: { kind: string }) => run.kind === "chapter_run"),
    ).toHaveLength(1);
    await captureChapter(page, `faux-${scenario}`);
    if (scenario === "plot_fail" || scenario === "reality_fail") {
      await page.locator(".chapter-verdicts").scrollIntoViewIfNeeded();
      await captureChapter(page, `faux-${scenario}-verdict`);
    }
  });
}

test("revision highlights unique edits, links notes and keeps invalid positions in the margin", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const id = await createDemo(page, "修订稿核对");
  const run = randomUUID();
  const old = randomUUID();
  const rows = [
    {
      id: run,
      kind: "chapter_run",
      chapter: "001",
      status: "AWAITING_CANDIDATE_APPROVAL",
    },
    {
      id: old,
      kind: "chapter_run",
      chapter: "001",
      status: "AWAITING_CANDIDATE_APPROVAL",
    },
    {
      id: randomUUID(),
      kind: "ideation_dispatch",
      chapter: "999",
      status: "SUCCEEDED",
    },
    { id: randomUUID(), kind: "chapter_run", chapter: "", status: "DONE" },
  ];
  const original =
    "第一章　换马\n\n林川把信封塞进内袋里。院边传来车轮声。\n\n他牵着马走进驿站。";
  const prose = original.replace("把信封塞进内袋里", "把信封放进内袋里");
  const detail = {
    run: {
      chapter: "001",
      status: "AWAITING_CANDIDATE_APPROVAL",
      candidateSha256: "a".repeat(64),
    },
    reports: {
      "qinggan-duzhe": {
        output: {
          reactions: [
            { anchor: "车轮声", type: "noticed", note: "声音把视线拉向门外。" },
            {
              anchor: "把信封塞进内袋里",
              type: "expected",
              note: "我在等信交到下一个人手里。",
            },
            {
              anchor: "不存在的引文",
              type: "misread",
              note: "这里没有找到原句。",
            },
          ],
        },
      },
      "wenxue-bianji": {
        output: {
          decision: "LOCAL_EDIT",
          edits: [
            {
              original: "把信封塞进内袋里",
              replacement: "把信封放进内袋里",
              kind: "literary",
              reason: "动作语气更轻。",
            },
            {
              original: "未能定位的原文",
              replacement: "只在批注中显示的建议",
              kind: "fact",
              reason: "旧报告中的修改位置已消失。",
            },
          ],
        },
      },
      "qingjie-heyanyuan": { output: { pass: true, issues: [] } },
      "xianshi-heyanyuan": { output: { pass: true, issues: [] } },
    },
    roles: [],
    original,
    prose,
    memoryFiles: [],
    factChanges: "{broken",
    literaryChanges: "",
  };
  await page.route(`**/api/projects/${id}/runs`, (route) =>
    route.fulfill({ json: rows }),
  );
  await page.route(`**/api/runs/${run}`, (route) =>
    route.fulfill({ json: detail }),
  );
  await page.route(`**/api/runs/${old}`, (route) =>
    route.fulfill({ json: detail }),
  );
  await page.route("**/api/runs/*/events", (route) =>
    route.fulfill({
      headers: { "content-type": "text/event-stream" },
      body: "event: heartbeat\ndata: {}\n\n",
    }),
  );
  const response = await page.goto(`/projects/${id}/chapters`);
  expect(await response?.text()).not.toMatch(/<[^>]+\sstyle=/i);
  await expect(
    page.getByRole("heading", { name: "第 1 章 · 换马", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(chapterCopy.deletedAnchor, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(chapterCopy.missingAnchor, { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator(".chapter-reader-mark mark")).toHaveText("车轮声");
  await page
    .getByRole("button", { name: annotationCopy.filters.editor, exact: true })
    .click();
  await expect(page.locator(".chapter-reader-mark mark")).toHaveCount(0);
  await expect(page.locator(".chapter-note.is-reader")).toHaveCount(0);
  await page
    .getByRole("button", { name: annotationCopy.filters.all, exact: true })
    .click();
  await page.locator(".chapter-reader-mark").click();
  await expect(
    page.locator(".chapter-note-toggle[aria-expanded=true]"),
  ).toContainText("声音把视线");
  await page.getByRole("button", { name: /文学编辑 · 文学修改/ }).click();
  await expect(
    page.getByRole("button", { name: "修订稿", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chapter-edit-mark del")).toHaveText(
    "把信封塞进内袋里",
  );
  await expect(page.locator(".chapter-edit-mark ins")).toHaveText(
    "把信封放进内袋里",
  );
  await expect(page.locator(".chapter-paper")).not.toContainText(
    "只在批注中显示的建议",
  );
  await expect(page.locator(".chapter-note")).toHaveCount(5);
  await expect(
    page.locator(".chapter-note").filter({ hasText: "只在批注中显示的建议" }),
  ).toBeVisible();
  await page.locator(".chapter-tools").scrollIntoViewIfNeeded();
  await captureChapter(page, "revision");
  await page.evaluate(() => scrollTo(0, 0));
  await page
    .locator(".chapter-role")
    .filter({ hasText: "小说作者" })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("heading", { name: chapterCopy.roleView }),
  ).toBeVisible();
  await captureChapter(page, "role-popover");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("heading", { name: chapterCopy.roleView }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "第 1 次", exact: true }).click();
  await expect(
    page.getByText(chapterCopy.historical(1), { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: chapterCopy.approve, exact: true }),
  ).toHaveCount(0);
  await captureChapter(page, "historical");
  await page
    .getByRole("button", { name: chapterCopy.newChapter, exact: true })
    .click();
  await expect(
    page.getByRole("spinbutton", { name: chapterCopy.chapterNumber }),
  ).toHaveValue("1");
  await captureChapter(page, "start-dialog");
});

test("archive every chapter status and the prototype over loopback HTTP", async ({
  page,
}) => {
  test.skip(
    process.env.FRONTEND_RED03_SCREENSHOTS !== "1",
    "Local report evidence only",
  );
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const id = await createDemo(page, "河谷驿站");
  const run = randomUUID();
  let state: keyof typeof runStatus = "REQUESTED";
  await page.route(`**/api/projects/${id}/runs`, (route) =>
    route.fulfill({
      json: [{ id: run, kind: "chapter_run", chapter: "001", status: state }],
    }),
  );
  await page.route(`**/api/runs/${run}/events`, (route) =>
    route.fulfill({
      headers: { "content-type": "text/event-stream" },
      body: "event: heartbeat\ndata: {}\n\n",
    }),
  );
  await page.route(`**/api/runs/${run}`, (route) => {
    const afterApproval = [
      "CANDIDATE_APPROVED",
      "MEMORY_PREVIEW_READY",
      "AWAITING_MEMORY_APPROVAL",
      "MEMORY_COMMITTED",
      "DONE",
    ].includes(state);
    const candidate = afterApproval || state === "AWAITING_CANDIDATE_APPROVAL";
    const prose = ["REQUESTED", "READINESS_OK", "FAILED_PRECONDITION"].includes(
      state,
    )
      ? ""
      : "第一章　换马\n\n林川在门前勒住马，把湿透的信封往衣襟里收了收。\n\n院门向里开了一条缝，有人拖着木屐出来看他。";
    return route.fulfill({
      json: {
        run: {
          chapter: "001",
          status: state,
          candidateSha256: candidate ? "a".repeat(64) : undefined,
        },
        roles: [],
        reports: {},
        prose,
        original: "",
        memoryFiles: [],
      },
    });
  });
  for (const status of Object.keys(runStatus) as (keyof typeof runStatus)[]) {
    state = status;
    await page.goto(`/projects/${id}/chapters`);
    await expect(page.getByTestId("run-status")).toHaveText(runStatus[state]);
    await expect(
      page.getByRole("list", { name: chapterCopy.progress }),
    ).toBeVisible();
    await captureChapter(
      page,
      `state-${status.toLowerCase().replaceAll("_", "-")}`,
    );
  }
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
    const url = "http://127.0.0.1:8765/ruwen-studio-redesign.html#chapter";
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
    await expect(page.locator('[data-page="chapter"]')).toHaveClass(/active/);
    await captureChapter(page, "reference-chapter");
  } finally {
    server.kill("SIGTERM");
  }
});

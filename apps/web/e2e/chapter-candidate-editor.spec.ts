import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { Detail } from "../src/components/chapter/review-data.ts";
import {
  candidateCopy as c,
  chapterCopy,
  frameCopy,
} from "../src/copy/zh-CN.ts";
import { readCandidate } from "./chapter-review.ts";
import { captureCleanup } from "./cleanup-11a.ts";
import { createDemoFromShelf as createDemo, signIn } from "./helpers.ts";

async function prepare(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const project = await createDemo(page, "驿站 · 候选稿版本");
  const { token } = (await (await page.request.get("/api/csrf")).json()) as {
    token: string;
  };
  const headers = { origin: new URL(page.url()).origin, "x-csrf-token": token };
  const launch = await page.request.post(`/api/projects/${project}/chapters`, {
    headers,
    data: { chapter: 1 },
  });
  expect(launch.status()).toBe(202);
  const { id } = (await launch.json()) as { id: string };
  const api = `/api/runs/${id}`;
  async function detail(): Promise<Detail> {
    return (await page.request.get(api)).json();
  }
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 60000 })
    .toBe("AWAITING_CANDIDATE_APPROVAL");
  await page.goto(`/projects/${project}/chapters?run=${id}`);
  const modify = page.getByRole("button", { name: c.modify, exact: true });
  await expect(modify).toBeEnabled();
  return { api, detail, headers, modify, project };
}

async function capture(page: Page, filename: string) {
  const captureMode = process.env.FRONTEND_RED03E_SCREENSHOTS;
  if (captureMode !== "1" && captureMode !== filename) return;
  await expect(page.locator(".project-bar")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(() => document.fonts.ready);
  const folder = new URL(
    "../../../docs/reports/frontend-redesign/03e/",
    import.meta.url,
  );
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${filename}.png`, folder)),
    animations: "disabled",
  });
}

function postResponse(page: Page, path: string) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === "POST" && new URL(r.url()).pathname === path,
  );
}

test("edits a candidate, inspects its history, reverifies and approves the latest hash", async ({
  page,
}) => {
  test.setTimeout(180000);
  const { api, detail, modify } = await prepare(page);
  const before = await detail();
  const initial = before.prose;
  const field = page.getByRole("textbox", { name: c.editor });
  const save = page.getByRole("button", { name: c.save, exact: true });
  const approve = page.getByRole("button", {
    name: chapterCopy.approve,
    exact: true,
  });
  const first = `${initial}\n\n院外传来另一阵车轮声。\n`;
  const latest = `${first}\n窗上的薄纸轻轻抖了一下。\n`;
  const basis = c.staleBasis(c.editorVersion);
  const badges = page.getByText(basis, { exact: true });
  const rev = page.getByRole("button", { name: c.reverify, exact: true });

  await modify.click();
  await expect(field).toHaveValue(initial);
  await field.fill("   ");
  await save.click();
  await expect(page.getByText(c.empty)).toBeVisible();
  await field.fill(first);
  await expect(approve).toHaveCount(0);
  await capture(page, "editing");
  await captureCleanup(page, "02");
  const shortHeight = await field.evaluate((editor) => editor.clientHeight);
  const long = `${first}${"\n\n院外传来另一阵车轮声。".repeat(80)}`;
  await field.fill(long);
  await expect(field).toHaveValue(long);
  await expect(field).toHaveCSS("overflow-y", "hidden");
  await expect(field).toHaveCSS("text-indent", /^36px(?: each-line)?$/);
  expect(
    await field.evaluate(
      (editor) => editor.clientHeight >= editor.scrollHeight,
    ),
  ).toBe(true);
  expect(await field.evaluate((editor) => editor.clientHeight)).toBeGreaterThan(
    shortHeight,
  );
  await field.fill(first);
  await expect
    .poll(() => field.evaluate((editor) => editor.clientHeight))
    .toBe(shortHeight);

  let savedResponse = postResponse(page, `${api}/candidate/revisions`);
  await save.click();
  const saved = await savedResponse;
  expect(saved.status()).toBe(201);
  expect(saved.request().postDataJSON()).toEqual({
    baseSha256: before.run.candidateSha256,
    text: first,
  });
  const firstVersion = (await saved.json()) as {
    version: number;
    sha256: string;
  };
  await expect(field).toHaveCount(0);
  await expect(
    page.getByText(`${c.userVersion(1)} · ${c.changeCount(1)}`),
  ).toBeVisible();
  await expect(badges).toHaveCount(2);
  await expect(page.getByText(c.staleReading(c.editorVersion))).toBeVisible();
  await page.locator(".chapter-verdicts").scrollIntoViewIfNeeded();
  await capture(page, "verification-stale");

  await modify.click();
  await field.fill(latest);
  savedResponse = postResponse(page, `${api}/candidate/revisions`);
  await save.click();
  const savedLatest = await savedResponse;
  expect(savedLatest.status()).toBe(201);
  expect(savedLatest.request().postDataJSON()).toEqual({
    baseSha256: firstVersion.sha256,
    text: latest,
  });
  const latestVersion = (await savedLatest.json()) as {
    version: number;
    sha256: string;
  };
  const versions = page.getByRole("combobox", { name: c.version, exact: true });
  await expect(versions).toHaveValue(String(latestVersion.version));
  await expect(versions.locator("option")).toHaveText([
    c.author,
    c.editorVersion,
    c.userVersion(1),
    c.userVersion(2),
  ]);
  await versions.selectOption(String(firstVersion.version));
  await expect(page.getByText(c.viewing(c.userVersion(1)))).toBeVisible();
  await expect(page.locator(".chapter-paper")).toContainText(
    "院外传来另一阵车轮声。",
  );
  await expect(page.locator(".chapter-paper")).not.toContainText(
    "窗上的薄纸轻轻抖了一下。",
  );
  await expect(approve).toHaveCount(0);
  await page.getByRole("button", { name: c.compare }).click();
  await expect(page.locator(".text-diff")).toContainText(
    "院外传来另一阵车轮声。",
  );
  await page.locator(".text-diff-mark").last().scrollIntoViewIfNeeded();
  await capture(page, "version-comparison");
  await page.getByRole("button", { name: c.latest }).click();
  await expect(page.locator(".chapter-paper")).toContainText(
    "窗上的薄纸轻轻抖了一下。",
  );

  // Hold the real response so even a fast faux verifier has an observable working state.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const routePath = `**${api}/reverify`;
  await page.route(routePath, async (route) => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  const verifyResponse = postResponse(page, `${api}/reverify`);
  try {
    await rev.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(c.reverifyConfirmation.body);
    await dialog.getByRole("button", { name: c.reverify, exact: true }).click();
    const working = page.locator(".chapter-roles .is-working");
    await expect(working).toHaveCount(2);
    await expect(approve).toBeDisabled();
    await page.locator(".chapter-roles").scrollIntoViewIfNeeded();
    await capture(page, "reverifying");
  } finally {
    release();
  }
  const check = await verifyResponse;
  expect(check.status()).toBe(202);
  expect(check.request().postDataJSON()).toEqual({
    expectedSha256: latestVersion.sha256,
  });
  await expect(badges).toHaveCount(0, { timeout: 60000 });
  await expect(rev).toHaveCount(0);
  await readCandidate(page);
  const approveResponse = postResponse(page, `${api}/approve-candidate`);
  await approve.click();
  const accepted = await approveResponse;
  expect(accepted.status()).toBe(202);
  expect(accepted.request().postDataJSON()).toEqual({
    confirmed: true,
    expectedSha256: latestVersion.sha256,
  });
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 60000 })
    .toBe("AWAITING_MEMORY_APPROVAL");
  await expect(modify).toHaveCount(0);
});

test("protects unsaved edits on navigation and refreshes only after a real conflict", async ({
  page,
}) => {
  test.setTimeout(150000);
  const { api, detail, headers, modify, project } = await prepare(page);
  const before = await detail();
  const field = page.getByRole("textbox", { name: c.editor });
  const local = `${before.prose}\n\n他打算绕开那条巷子。\n`;
  const remote = `${before.prose}\n\n他在桥上停了下来。\n`;
  const dialog = page.getByRole("dialog", {
    name: c.discardConfirmation.title,
  });
  const stay = dialog.getByRole("button", { name: "取消", exact: true });
  const discard = dialog.getByRole("button", { name: c.discard, exact: true });
  await modify.click();
  await field.fill(local);
  await page
    .getByRole("link", { name: frameCopy.overview, exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/chapters\?run=/);
  await capture(page, "discard-confirmation");
  await stay.click();
  await expect(field).toHaveValue(local);
  await page
    .getByRole("button", { name: chapterCopy.clean, exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await stay.click();
  await expect(field).toHaveValue(local);
  expect(
    await page.evaluate(
      () =>
        !window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ),
  ).toBe(true);

  const external = await page.request.post(`${api}/candidate/revisions`, {
    headers,
    data: { baseSha256: before.run.candidateSha256, text: remote },
  });
  expect(external.status()).toBe(201);
  const failed = postResponse(page, `${api}/candidate/revisions`);
  await page.getByRole("button", { name: c.save, exact: true }).click();
  expect((await failed).status()).toBe(409);
  await expect(page.getByText(c.conflict, { exact: true })).toBeVisible();
  await expect(field).toHaveValue(local);
  await capture(page, "conflict");
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  await stay.click();
  await expect(field).toHaveValue(local);
  await page.getByRole("button", { name: c.refresh, exact: true }).click();
  await discard.click();
  await expect(field).toHaveCount(0);
  await expect(page.locator(".chapter-paper")).toContainText(
    "他在桥上停了下来。",
  );
  await modify.click();
  await field.fill(local);
  await page
    .getByRole("link", { name: frameCopy.overview, exact: true })
    .click();
  await discard.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${project}$`));
});

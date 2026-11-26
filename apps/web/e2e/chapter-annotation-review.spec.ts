import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { Database, PostgresFS } from "@ruwen/db";
import { loadRun, runPath } from "@ruwen/pipeline";
import { previewConfiguration } from "../../../config/preview.ts";
import type { Detail } from "../src/components/chapter/review-data.ts";
import {
  annotationCopy as c,
  chapterCopy,
  roleName,
  candidateCopy as v,
} from "../src/copy/zh-CN.ts";
import { readCandidate } from "./chapter-review.ts";
import { createDemoFromShelf as createDemo, signIn } from "./helpers.ts";

const edit = {
  original: "林川把信封塞进内袋里",
  replacement: "林川把信封轻轻按回内袋",
  reason: "动作放轻，保留下一句的停顿。",
  kind: "literary",
};

async function seedEditorFinding(project: string, id: string) {
  // The normal faux chapter has no edits. Add one finding to this disposable project
  // so the browser can exercise the real version and feedback API.
  const db = new Database(previewConfiguration().databaseUrl);
  try {
    const { rows } = await db.pool.query<{ owner_id: string }>(
      "SELECT owner_id FROM projects WHERE id=$1",
      [project],
    );
    const owner = rows[0]?.owner_id;
    if (!owner) throw new Error("Missing fixture project");
    const fs = new PostgresFS(db, project, owner);
    await fs.transaction(async (tx) => {
      const run = await loadRun(tx, id);
      const path = run.paths.candidate;
      const report = run.roles["wenxue-bianji"]?.path;
      if (!path || !report) throw new Error("Missing faux editor artifacts");
      const before = await tx.readText(path);
      expect(before.split(edit.original)).toHaveLength(2);
      const after = before.replace(edit.original, edit.replacement);
      await tx.write(path, after);
      const sha256 = await tx.sha256(path);
      run.candidateSha256 = sha256;
      run.verificationBasisSha256 = sha256;
      const version = run.candidateVersions?.find(
        (item) => item.version === run.candidateVersion,
      );
      if (version)
        Object.assign(version, { sha256, chars: Array.from(after).length });
      await tx.write(runPath(id), JSON.stringify(run));
      const result = JSON.parse(await tx.readText(report));
      result.output.edits = [edit];
      await tx.write(report, JSON.stringify(result));
      const changed = await tx.sql(
        "UPDATE role_runs SET result=jsonb_set(result,'{output,edits}',$2::jsonb) WHERE run_id=$1 AND role_id='wenxue-bianji' AND status='completed'",
        [id, JSON.stringify([edit])],
      );
      expect(changed.rowCount).toBe(1);
    });
  } finally {
    await db.close();
  }
}

async function prepare(page: Page, simulation?: "plot_fail") {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const project = await createDemo(page, "河谷驿站 · 审稿意见");
  const { token } = (await (await page.request.get("/api/csrf")).json()) as {
    token: string;
  };
  const headers = { origin: new URL(page.url()).origin, "x-csrf-token": token };
  const launch = await page.request.post(`/api/projects/${project}/chapters`, {
    headers,
    data: { chapter: 1, ...(simulation && { simulation }) },
  });
  expect(launch.status()).toBe(202);
  const { id } = (await launch.json()) as { id: string };
  const api = `/api/runs/${id}`;
  const detail = async (): Promise<Detail> =>
    (await page.request.get(api)).json();
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 60000 })
    .toBe(simulation ? "RETURNED" : "AWAITING_CANDIDATE_APPROVAL");
  if (!simulation) await seedEditorFinding(project, id);
  const response = await page.goto(`/projects/${project}/chapters?run=${id}`);
  expect(await response?.text()).not.toMatch(/<[^>]+\sstyle=/i);
  return { api, detail, headers };
}

async function capture(page: Page, filename: string, target?: Locator) {
  const captureMode = process.env.FRONTEND_RED03F_SCREENSHOTS;
  if (captureMode !== "1" && captureMode !== filename) return;
  await target?.evaluate((node) =>
    node.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await expect(page.locator(".project-bar")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(() => document.fonts.ready);
  const folder = new URL(
    "../../../docs/reports/frontend-redesign/03f/",
    import.meta.url,
  );
  await mkdir(folder, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${filename}.png`, folder)),
    animations: "disabled",
  });
}

function postRevision(page: Page, api: string) {
  return page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `${api}/candidate/revisions`,
  );
}

test("handles chapter opinions, locates anchors, and versions editor undo and restore", async ({
  page,
}) => {
  test.setTimeout(210000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { api, detail, headers } = await prepare(page);
  const initial = await detail();
  const editor = initial.annotations.find(({ kind }) => kind === "editor");
  if (!editor) throw new Error("Missing annotated edit");
  const progress = page.locator(".chapter-annotation-header");
  const mark = page
    .getByRole("button", {
      name: new RegExp(`定位${roleName["qinggan-duzhe"]}`),
    })
    .first();
  const reader = page.locator(
    ".chapter-note.is-reader .chapter-annotation-card",
  );
  const editorCard = page.locator(
    ".chapter-note.is-editor .chapter-annotation-card",
  );
  const filter = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const mode = filter(chapterCopy.revised);
  const paper = page.locator(".chapter-paper");
  const revert = editorCard.getByRole("button", { name: c.revert });
  const basis = page.getByText(v.staleBasis(v.editorVersion), {
    exact: true,
  });

  await expect(progress).toContainText(c.count(4, 0));
  await mark.click();
  await expect(mark).toHaveAttribute("aria-pressed", "true");
  // The rail control points to the stable ID of the visible card.
  const controlled = await mark.getAttribute("aria-controls");
  const selected = page
    .locator(".chapter-annotation-card")
    .and(page.locator(`[id="${controlled}"]`));
  await expect(selected).toHaveAttribute("data-active", "true");
  await expect(selected).toHaveAttribute("data-status", "open");
  await capture(page, "margin-rail");
  const firstId = await reader.first().getAttribute("id");
  const handled = page.locator(`[id="${firstId}"]`);
  await handled.getByRole("button", { name: c.accept, exact: true }).click();
  await expect(progress).toContainText(c.count(4, 1));
  await expect(handled).toHaveAttribute("data-status", "accepted");
  await expect(handled.locator(".chapter-note-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await capture(page, "progress", progress);
  await capture(page, "processed-and-open", handled);
  await handled.locator(".chapter-note-toggle").click();
  const useful = handled.getByRole("button", { name: c.useful, exact: true });
  const notUseful = handled.getByRole("button", {
    name: c.notUseful,
    exact: true,
  });
  await useful.click();
  await expect(useful).toHaveAttribute("aria-pressed", "true");
  await notUseful.click();
  await expect(useful).toHaveAttribute("aria-pressed", "false");
  await expect(notUseful).toHaveAttribute("aria-pressed", "true");
  await notUseful.click();
  await expect(notUseful).toHaveAttribute("aria-pressed", "false");
  await expect(progress).toContainText(c.count(4, 1));
  await filter(c.filters.open).click();
  await expect(handled).toHaveCount(0);
  await expect(reader).toHaveCount(2);
  await filter(c.filters.editor).click();
  await expect(reader).toHaveCount(0);
  await expect(editorCard).toHaveCount(1);
  await capture(page, "filter", progress);
  await mode.click();
  await expect(paper.locator(".chapter-edit-mark ins")).toHaveText(
    edit.replacement,
  );
  const reverting = postRevision(page, api);
  await revert.click();
  const undone = await reverting;
  expect(undone.status()).toBe(201);
  expect(undone.request().postDataJSON()).toEqual({
    baseSha256: initial.run.candidateSha256,
    op: "revert_editor_edits",
    editIds: [editor.id],
  });
  await expect(editorCard).toHaveAttribute("data-status", "dismissed");
  await expect(paper).toContainText(edit.original);
  await expect(paper.locator(".chapter-edit-mark")).toHaveCount(0);
  await expect(basis).toHaveCount(2);
  await capture(page, "reverted-revision", editorCard);
  await editorCard.locator(".chapter-note-toggle").click();
  const restoring = postRevision(page, api);
  await editorCard.getByRole("button", { name: c.restore }).click();
  const restoredResponse = await restoring;
  expect(restoredResponse.status()).toBe(201);
  expect(restoredResponse.request().postDataJSON()).toEqual({
    baseSha256: (await undone.json()).sha256,
    op: "reapply_editor_edits",
    editIds: [editor.id],
  });
  await expect(editorCard).toHaveAttribute("data-status", "accepted");
  await expect(paper.locator(".chapter-edit-mark ins")).toHaveText(
    edit.replacement,
  );
  await expect(basis).toHaveCount(0);

  const restored = await detail();
  const external = await page.request.post(`${api}/candidate/revisions`, {
    headers,
    data: {
      baseSha256: restored.run.candidateSha256,
      text: `${restored.prose}\n\n${edit.replacement}。\n`,
    },
  });
  expect(external.status()).toBe(201);
  await editorCard.locator(".chapter-note-toggle").click();
  let conflict = postRevision(page, api);
  await revert.click();
  expect((await conflict).status()).toBe(409);
  await expect(editorCard.getByText(v.conflict)).toBeVisible();
  await editorCard.getByRole("button", { name: v.refresh }).click();
  await expect(editorCard.getByText(v.conflict)).toHaveCount(0);
  conflict = postRevision(page, api);
  await revert.click();
  const failed = await conflict;
  expect(failed.status()).toBe(409);
  expect((await failed.json()).editIds).toEqual([editor.id]);
  await expect(editorCard.getByText(c.missingAnchor)).toBeVisible();
  await capture(page, "revert-failure", editorCard);
  await editorCard.getByRole("button", { name: c.openEditor }).click();
  const field = page.getByRole("textbox", { name: v.editor });
  await expect(field).toHaveValue(
    `${restored.prose}\n\n${edit.replacement}。\n`,
  );
  await field.fill(restored.prose);
  await filter(v.save).click();
  await expect(field).toHaveCount(0);
  // Two reader comments are still open. The ordinary reading gate is sufficient.
  await readCandidate(page);
  await filter(chapterCopy.approve).click();
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 60000 })
    .toBe("AWAITING_MEMORY_APPROVAL");
  await expect(filter(v.modify)).toHaveCount(0);
  await expect(revert).toBeDisabled();
  await editorCard.getByRole("button", { name: c.useful, exact: true }).click();
  await expect(
    editorCard.getByRole("button", { name: c.useful, exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("handles an unanchored verification issue after a run returns", async ({
  page,
}) => {
  const { detail } = await prepare(page, "plot_fail");
  await page
    .getByRole("button", { name: c.filters.verification, exact: true })
    .click();
  const issue = page.locator(".chapter-verdict-issue .chapter-annotation-card");
  await expect(issue).toBeVisible();
  await expect(page.getByRole("button", { name: /定位/ })).toHaveCount(0);
  await issue.getByRole("button", { name: c.ignore, exact: true }).click();
  await expect(issue).toHaveAttribute("data-status", "dismissed");
  await issue.locator(".chapter-note-toggle").click();
  await issue.getByRole("button", { name: c.accept, exact: true }).click();
  await expect(issue).toHaveAttribute("data-status", "accepted");
  await issue.locator(".chapter-note-toggle").click();
  const rating = issue.getByRole("button", { name: c.notUseful, exact: true });
  await rating.click();
  await expect(rating).toHaveAttribute("aria-pressed", "true");
  expect(
    (await detail()).annotations.find(({ kind }) => kind === "plot"),
  ).toMatchObject({
    status: "accepted",
    usefulness: "not_useful",
  });
});

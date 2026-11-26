import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { Detail } from "../src/components/chapter/review-data.ts";
import { chapterCopy, roleName } from "../src/copy/zh-CN.ts";
import { createDemo, signIn } from "./helpers.ts";

const stages = [
  ["xiaoshuo-zuozhe", "author"],
  ["qinggan-duzhe", "reader"],
  ["wenxue-bianji", "editor"],
  ["qingjie-heyanyuan", "plot"],
  ["xianshi-heyanyuan", "reality"],
  ["jiyi-weihuyuan", "memory"],
] as const;
const count = new Intl.NumberFormat("zh-CN");

async function capture(page: Page, name: string) {
  if (process.env.FRONTEND_RED03T_SCREENSHOTS !== "1") return;
  await page.evaluate(() => document.fonts.ready);
  const root = new URL(
    "../../../docs/reports/frontend-redesign/03t/",
    import.meta.url,
  );
  await mkdir(root, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(`${name}.png`, root)),
    animations: "disabled",
  });
}

test("chapter desk displays current role manifests, reverification, and the legacy fallback", async ({
  page,
}) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const project = await createDemo(page, "驿站 · 岗位输入记录");
  const csrf = await page.request.get("/api/csrf");
  const { token } = (await csrf.json()) as { token: string };
  const headers = {
    origin: new URL(page.url()).origin,
    "x-csrf-token": token,
  };
  const launch = await page.request.post(`/api/projects/${project}/chapters`, {
    headers,
    data: { chapter: 1 },
  });
  expect(launch.status()).toBe(202);
  const { id: runId } = (await launch.json()) as { id: string };
  const api = `/api/runs/${runId}`;
  const detail = async (): Promise<Detail> =>
    (await page.request.get(api)).json();
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 60000 })
    .toBe("AWAITING_CANDIDATE_APPROVAL");

  const before = await detail();
  const save = await page.request.post(`${api}/candidate/revisions`, {
    headers,
    data: {
      baseSha256: before.run.candidateSha256,
      text: `${before.prose}\n\n院外传来另一阵车轮声。\n`,
    },
  });
  expect(save.status()).toBe(201);
  const { sha256 } = (await save.json()) as { sha256: string };
  const reverify = await page.request.post(`${api}/reverify`, {
    headers,
    data: { expectedSha256: sha256 },
  });
  expect(reverify.status()).toBe(202);
  const { id: verificationId } = (await reverify.json()) as { id: string };
  await expect
    .poll(async () => (await detail()).run.verificationRunId, {
      timeout: 60000,
    })
    .toBe(verificationId);

  const approval = await page.request.post(`${api}/approve-candidate`, {
    headers,
    data: { confirmed: true, expectedSha256: sha256 },
  });
  expect(approval.status()).toBe(202);
  await expect
    .poll(async () => (await detail()).run.status, { timeout: 60000 })
    .toBe("AWAITING_MEMORY_APPROVAL");

  const saved = await detail();
  const desk = `/projects/${project}/chapters?run=${runId}`;
  const response = await page.goto(desk);
  expect(await response?.text()).not.toMatch(/<[^>]+\sstyle=/i);
  const author = saved.roles.find(
    ({ role_id }) => role_id === "xiaoshuo-zuozhe",
  )?.inputManifest;
  if (!author?.totals.packetChars || !author.totals.packetBudget)
    throw new Error("Expected a compiled author packet manifest");
  await expect(page.locator(".chapter-input-summary")).toHaveText(
    `本章小说作者只看到了 ${author.seen.length} 份资料（共 ${count.format(author.totals.packetChars)} 字），没有看到故事大纲、人物全档和研究资料。`,
  );
  await capture(page, "header-summary");

  const popover = page.locator(".chapter-role-popover");
  const chain = page.getByRole("list", { name: chapterCopy.progress });
  for (const [role, image] of stages) {
    const row = saved.roles.find(({ role_id }) => role_id === role);
    const manifest = row?.inputManifest;
    const item = manifest?.seen[0];
    if (!manifest || !item)
      throw new Error(`Expected a saved manifest for ${role}`);
    await chain
      .getByRole("button", { name: new RegExp(roleName[role]) })
      .click();
    await expect(
      popover.getByRole("heading", { name: "看到了", exact: true }),
    ).toBeVisible();
    await expect(
      popover.getByText(item.label, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      popover.locator("li").filter({ hasText: item.label }).first(),
    ).toContainText(
      `${count.format(item.chars)} 字${item.truncated ? "（已截断）" : ""}`,
    );
    await expect(
      popover.getByText(
        `${count.format(manifest.rules.upstreamFileCount)} 份 · ${count.format(manifest.rules.chars)} 字`,
        { exact: true },
      ),
    ).toBeVisible();
    if (row.model) await expect(popover).not.toContainText(row.model);

    if (role === "xiaoshuo-zuozhe") {
      await expect(popover).toContainText(
        `资料包 ${count.format(author.totals.packetChars)} / ${count.format(author.totals.packetBudget)} 字`,
      );
      const fill = popover.locator(".chapter-manifest-budget span");
      await expect
        .poll(async () =>
          Number.parseFloat(
            await fill.evaluate((node: HTMLSpanElement) => node.style.width),
          ),
        )
        .toBeCloseTo(
          (author.totals.packetChars / author.totals.packetBudget) * 100,
          3,
        );
      await expect(popover).toContainText("按如文规则，小说作者不看故事大纲。");
    }

    if (role === "qingjie-heyanyuan" || role === "xianshi-heyanyuan") {
      const old = before.roles
        .find(({ role_id }) => role_id === role)
        ?.inputManifest?.seen.find(({ kind }) => kind === "prose")?.sha256;
      const current = manifest.seen.find(
        ({ kind }) => kind === "prose",
      )?.sha256;
      expect(old).toBeTruthy();
      expect(current).toBeTruthy();
      expect(current).not.toBe(old);
      if (!current) throw new Error("Expected a reverification prose digest");
      await expect(
        popover.getByText(current, { exact: true }),
      ).not.toBeVisible();
      const technical = popover.getByText("技术信息", { exact: true });
      await technical.click();
      await expect(popover.getByText(current, { exact: true })).toBeVisible();
      await technical.click();
    }

    await popover.evaluate((node) => {
      node.scrollTop = 0;
    });
    await capture(page, image);
  }

  await page.route(`**${api}`, async (route) => {
    const real = await route.fetch();
    const data = (await real.json()) as Detail;
    for (const role of data.roles) role.inputManifest = null;
    await route.fulfill({ response: real, json: data });
  });
  await page.reload();
  await chain.getByRole("button", { name: /小说作者/ }).click();
  await expect(popover.getByText("这次运行没有逐项记录")).toBeVisible();
  await expect(popover).toContainText(chapterCopy.roleAccess[0][0]);
  await expect(page.locator(".chapter-input-summary")).toHaveCount(0);
  await capture(page, "legacy-fallback");
});

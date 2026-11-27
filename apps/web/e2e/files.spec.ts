import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { Database, PostgresFS } from "@ruwen/db";
import { previewConfiguration } from "../../../config/preview.ts";
import { captureCleanup } from "./cleanup-11a.ts";
import { createDemoFromShelf, signIn } from "./helpers.ts";

const researchPath = "研究/渡口冬季通行调查.md";
const unregisteredPath = "研究/未登记的调查笔记.md";
const chapterPath = "chapters/chapter-001.md";
const registryPath = "治理/资源注册表.json";
const auditPath = "治理/审计账本.jsonl";

async function seedReadingFiles(projectId: string) {
  const db = new Database(previewConfiguration().databaseUrl);
  try {
    const { rows } = await db.pool.query<{ owner_id: string }>(
      "SELECT owner_id FROM projects WHERE id=$1",
      [projectId],
    );
    const owner = rows[0]?.owner_id;
    if (!owner) throw new Error("Missing project for reading fixtures");
    await new PostgresFS(db, projectId, owner).transaction(async (fs) => {
      await fs.write(
        researchPath,
        [
          "# 渡口冬季通行调查",
          "入冬之后，渡船依水位和冰况调整班次。枯水时，装货的位置向下游移，货船需要从另一条浅滩绕行。",
          "## 待核实",
          "- 闭渡期间沿岸可供过夜的驿站。",
          "- 冰面开始松动后，货船恢复通行的时间。",
        ].join("\n\n"),
      );
      await fs.write(unregisteredPath, "还有一处古渡口需要核对。");
      const registry = JSON.parse(await fs.readText(registryPath));
      registry.resources.push({
        id: "dukou-research",
        title: "冬季渡口调查",
        path: researchPath,
        type: "evidence",
        status: "candidate",
        owner: "waibu-zhishi-guwen",
        version: "1.0.0",
        scope: {
          project: "demo-ruwen",
          volumes: ["北岸卷"],
          arcs: ["回乡"],
          chapters: ["001"],
          scene_types: ["过渡"],
          povs: ["林川"],
        },
        readers: ["waibu-zhishi-guwen", "qingjie-heyanyuan"],
        allow_author: false,
        source_sha256: await fs.sha256(researchPath),
        supersedes: null,
        approval: { status: "unapproved" },
      });
      await fs.write(registryPath, JSON.stringify(registry));
      await fs.write(
        chapterPath,
        [
          "# 第一章　换马",
          "林川在渡口站了许久。隔岸的灯隔着雾，时明时暗。他把袖口往下扯了扯，遮住手腕上那枚裂口的铁环。",
          "船夫又问他一遍要不要等。林川听见背后有脚步走近，回过头，河埠上的青石已经叫霜盖白了。",
          "「等。」他说。船夫便收了橹，只留下一盏灯。",
        ].join("\n\n"),
      );
      const audit = {
        role: "xiangmu-zhiliyuan",
        resource_ids: ["dukou-research"],
        scope: {
          project: "demo-ruwen",
          volume: null,
          arc: null,
          chapter: null,
        },
        conflict_category: null,
        approval_status: "approved",
        result: "committed",
      };
      const original = (await fs.readText(auditPath)).trimEnd();
      await fs.write(
        auditPath,
        `${[
          JSON.stringify({
            ...audit,
            time: "2026-11-08T09:45:00+08:00",
            change: "memory_preview_committed",
          }),
          original,
          JSON.stringify({
            ...audit,
            time: "2026-11-08T01:10:00Z",
            change: "ideation_preview_committed",
          }),
          JSON.stringify({ ...audit, change: "legacy_import" }),
        ].join("\n")}\n`,
      );
    });
  } finally {
    await db.close();
  }
}

async function capture(page: Page, name: string) {
  if (process.env.FRONTEND_RED08_SCREENSHOTS !== "1") return;
  await expect(page.locator(".project-bar")).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await page.evaluate(() => document.fonts.ready);
  const directory = new URL(
    "../../../docs/reports/frontend-redesign/08/",
    import.meta.url,
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: fileURLToPath(new URL(name.concat(".png"), directory)),
    animations: "disabled",
  });
}

test.use({ viewport: { width: 1440, height: 900 } });

test("项目资料按目录浏览，从注册表显示元数据，结构化渲染文件", async ({
  page,
}) => {
  await signIn(page);
  const projectId = await createDemoFromShelf(page, "河谷驿站 · 项目资料");
  await seedReadingFiles(projectId);
  await page.goto("/projects/".concat(projectId, "/files"));
  const tree = page.getByRole("navigation", { name: "项目文件" });
  const reader = page.getByRole("article", { name: "文件阅读区" });
  const folder = (name: string) =>
    tree.getByRole("button", { name, exact: true });
  const file = (path: string) =>
    tree.getByRole("button", { name: path, exact: true });
  const heading = (name: string) =>
    reader.getByRole("heading", { name, exact: true });

  await expect(file("人物/主角档案.md")).toBeVisible();
  for (const group of ["项目/", "人物/", "世界/", "故事/"])
    await expect(folder(group)).toHaveAttribute("aria-expanded", "true");
  for (const group of ["治理/ 系统记录", "authoring-ruwen-v5/ 系统记录"])
    await expect(folder(group)).toHaveAttribute("aria-expanded", "false");
  await expect(reader).toContainText(
    "选择左侧的一份资料。浏览不会改变任何内容。",
  );
  await capture(page, "no-selection");

  await file("人物/主角档案.md").click();
  await expect(heading("主角档案.md")).toBeVisible();
  await expect(reader.getByText("已启用", { exact: true })).toBeVisible();
  await expect(reader.getByText("林川").first()).toBeVisible();
  await capture(page, "protagonist");
  const technical = reader.locator(".files-technical");
  await expect(technical.locator("code")).not.toBeVisible();
  await technical.getByText("技术信息", { exact: true }).click();
  await expect(technical.locator("dt")).toHaveText(["SHA-256"]);
  await expect(technical.locator("code")).toHaveText(/^[a-f\d]{64}$/);
  await expect(reader.getByText("查看原文", { exact: true })).toHaveCount(0);

  await folder("研究/").click();
  await expect(file(researchPath)).toHaveAccessibleDescription("候选");
  await file(researchPath).click();
  await expect(heading("渡口冬季通行调查.md")).toBeVisible();
  await expect(reader.getByText("候选", { exact: true })).toBeVisible();
  await expect(reader.locator(".files-scope-tag")).toHaveText([
    "卷北岸卷",
    "篇章回乡",
    "章节001",
    "场景类型过渡",
    "视角林川",
  ]);
  await expect(reader.locator(".ui-role-tag")).toHaveText([
    "外部知识顾问",
    "情节核验员",
  ]);
  await capture(page, "candidate-research");
  await file(unregisteredPath).click();
  await expect(reader).toContainText("未登记到注册表，岗位无法读取");
  await expect(reader).not.toContainText("系统记录，不供岗位读取");

  await folder("治理/ 系统记录").click();
  await file(registryPath).click();
  const table = reader.getByRole("table", { name: "资源注册表" });
  await expect(table.getByRole("columnheader")).toHaveText([
    "资源",
    "路径",
    "状态",
    "可读取的岗位",
  ]);
  const resource = table.getByRole("row", { name: /冬季渡口调查/ });
  await expect(resource).toContainText("候选");
  await expect(
    table.getByRole("rowheader", { name: /^主角档案\.md/ }),
  ).toBeVisible();
  const resourceId = resource.getByText("dukou-research", { exact: true });
  await expect(resourceId).toBeHidden();
  await resource.getByText("技术信息", { exact: true }).click();
  await expect(resourceId).toBeVisible();
  await captureCleanup(page, "07");
  await resource.getByText("技术信息", { exact: true }).click();
  await expect(reader).not.toContainText('"resources"');
  await capture(page, "registry-table");

  await file(auditPath).click();
  await expect(reader).toContainText("系统记录，不供岗位读取");
  await captureCleanup(page, "06");
  const ledger = reader.getByRole("list", { name: "账本记录" });
  await expect(ledger.locator("li summary")).toHaveCount(4);
  await expect(ledger.locator("summary time")).toHaveText([
    "2026-11-08 01:45 UTC",
    "2026-11-08 01:10 UTC",
    "2026-11-06 11:05 UTC",
  ]);
  await expect(ledger.locator("summary").last()).toHaveText(/账本记录/);
  await capture(page, "audit-ledger");
  await ledger.getByText("提交记忆变更", { exact: true }).click();
  await expect(ledger.getByText("涉及资源", { exact: true })).toBeVisible();
  await expect(
    ledger.getByText("dukou-research", { exact: true }),
  ).toBeVisible();
  await expect(reader).not.toContainText('"resource_ids"');

  await folder("chapters/").click();
  await file(chapterPath).click();
  await expect(reader.locator(".chapter-paper")).toContainText(
    "林川在渡口站了许久",
  );
  await expect(reader).toContainText("未登记到注册表，岗位无法读取");
  await capture(page, "chapter-paper");

  const search = tree.getByRole("searchbox", { name: "筛选文件" });
  await search.fill("渡口");
  await expect(folder("研究/")).toHaveAttribute("aria-expanded", "true");
  await expect(folder("项目/")).toHaveCount(0);
  await expect(file(researchPath)).toBeVisible();
  await file(researchPath).click();
  await expect(heading("渡口冬季通行调查.md")).toBeVisible();
  await capture(page, "file-filter");
  await search.fill("没有这个文件");
  await expect(tree.getByText("没有符合条件的文件。")).toBeVisible();
  await search.clear();

  await folder("authoring-ruwen-v5/ 系统记录").click();
  await file("authoring-ruwen-v5/state.json").click();
  await expect(reader.locator(".ui-key-values")).toBeVisible();
  await expect(reader).toContainText("系统记录，不供岗位读取");
  await expect(reader).not.toContainText('"schema_version"');
  await expect(reader.locator("[style]")).toHaveCount(0);
  await page.setViewportSize({ width: 1180, height: 900 });
  await expect(tree).toHaveCSS("width", "300px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    1180,
  );
});

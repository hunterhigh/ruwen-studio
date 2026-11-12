import { expect, test } from "@playwright/test";
import { createFauxRuntime, type Data, runRole } from "@ruwen/agents";
import { publicRoleResult } from "@ruwen/core";
import { Database, PostgresFS } from "@ruwen/db";
import { previewConfiguration } from "../../../config/preview.ts";
import { defaultFauxResponse } from "../../../packages/agents/src/faux.ts";
import { createDemo, signIn } from "../../web/e2e/helpers.ts";

test("owner can read adjusted, dropped and attempted reader diagnostics in the existing project file browser", async ({
  page,
}) => {
  await signIn(page);
  const projectId = await createDemo(page, "读者锚点诊断");
  const db = new Database(previewConfiguration().databaseUrl);
  const path =
    "authoring-ruwen-v5/reports/runs/reader-browser-fixture/qinggan-duzhe.json";
  try {
    const row = await db.pool.query<{ owner_id: string }>(
      "SELECT owner_id FROM projects WHERE id=$1",
      [projectId],
    );
    const fs = new PostgresFS(db, projectId, row.rows[0]?.owner_id ?? "");
    const original = "林川不知道那布条是做什么用的。也许是伤了，也许只是冷。";
    const prose = `${original}粮车已经离开驿站。风从河谷吹来。`;
    const reaction = (anchor: string): Data => ({
      anchor,
      type: "noticed",
      note: "注意到等待仍在继续。",
    });
    const runtime = createFauxRuntime(
      Array.from({ length: 2 }, () => (context) => {
        const response = defaultFauxResponse(context);
        const call = response.content.find(
          (b) => b.type === "toolCall" && b.name === "submit_reading",
        );
        if (!call || call.type !== "toolCall")
          throw new Error("Missing reading");
        call.arguments.reactions = [
          reaction(original.replace("林川", "他")),
          reaction("粮车已经离开驿站。"),
          reaction("风从河谷吹来。"),
          reaction("星际舰队已经飞出银河系"),
        ];
        return response;
      }),
    );
    const result = await runRole(
      "qinggan-duzhe",
      { prose },
      {
        fs,
        projectKey: "demo-ruwen",
        runtime,
      },
    );
    await fs.write(path, JSON.stringify(publicRoleResult(result), null, 2));
  } finally {
    await db.close();
  }
  await page.goto(`/projects/${projectId}/files`);
  await page.getByRole("button", { name: path, exact: true }).click();
  const content = page.locator(".file-content");
  await expect(content).toContainText("anchor_adjusted");
  await expect(content).toContainText("dropped_reactions");
  await expect(content).toContainText("星际舰队已经飞出银河系");
  await expect(content).toContainText('"attempt": 1');
  await expect(content).toContainText(
    "Prose anchors must quote the current prose exactly",
  );
});

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createDemo, signIn } from "./helpers.ts";

for (const refusal of [false, true]) {
  test(`chapter delta → reset → ${refusal ? "refusal" : "corrected delta"} clears only the current attempt and ignores replay`, async ({
    page,
  }) => {
    await signIn(page);
    const projectId = await createDemo(page, "重置章节试读");
    const runId = randomUUID();
    await page.route(`**/api/projects/${projectId}/runs`, (route) =>
      route.fulfill({
        json: [{ id: runId, chapter: "1", status: "REQUESTED" }],
      }),
    );
    await page.route(`**/api/runs/${runId}`, (route) =>
      route.fulfill({
        json: {
          run: { id: runId, chapter: "1", status: "REQUESTED", costTotal: "0" },
          roles: [],
          reports: {},
          prose: "",
          original: "",
          memoryFiles: [],
        },
      }),
    );
    await page.addInitScript(() => {
      class ControlledSource extends EventTarget {
        onopen: ((event: Event) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;
        constructor(readonly url: string) {
          super();
          window.addEventListener("test:stream", this.deliver);
          setTimeout(() => this.onopen?.(new Event("open")), 0);
        }
        deliver = (event: Event) => {
          const detail = (event as CustomEvent).detail;
          if (detail.url === this.url)
            this.dispatchEvent(
              new MessageEvent(detail.type, {
                data: JSON.stringify(detail.data),
                lastEventId: detail.id,
              }),
            );
        };
        close() {
          window.removeEventListener("test:stream", this.deliver);
        }
      }
      Object.defineProperty(window, "EventSource", { value: ControlledSource });
    });
    // The page still authorizes the real project; only its browser-side run API is a fixture.
    await page.goto(`/projects/${projectId}/chapters`);
    await expect(page.getByText("实时连接", { exact: true })).toBeVisible();
    const send = (type: string, id: string, text?: string) =>
      page.evaluate(
        ({ type, id, text, runId }) => {
          window.dispatchEvent(
            new CustomEvent("test:stream", {
              detail: {
                url: `/api/runs/${runId}/events`,
                type,
                id,
                data: {
                  role: "xiaoshuo-zuozhe",
                  text,
                  reason: "format_correction",
                },
              },
            }),
          );
        },
        { type, id, text, runId },
      );
    await send("delta", "101", "旧尝试不应留在画面。 ");
    await expect(page.locator(".manuscript")).toContainText(
      "旧尝试不应留在画面。",
    );
    await send("reset", "102");
    await expect(page.locator(".manuscript")).not.toContainText(
      "旧尝试不应留在画面。",
    );
    await expect(
      page.getByText("正文将在这里逐步出现。", { exact: true }),
    ).toBeVisible();
    const after = refusal
      ? "这部分属于平台内部设置，我没法提供。我们继续聊你的故事吧。"
      : "新尝试，从空白处继续。";
    await send("delta", "103", after);
    await expect(page.locator(".prose-paragraph")).toHaveText(after);
    await send("reset", "102");
    await send("delta", "103", after);
    await expect(page.locator(".prose-paragraph")).toHaveText(after);
  });

  test(`ideation keyed buffers isolate sessions and runs across reset → ${refusal ? "refusal" : "delta"}`, async ({
    page,
  }) => {
    await signIn(page);
    const projectId = await createDemo(page, "重置构思试读");
    await page.goto(`/projects/${projectId}/ideation`);
    await page.getByText("流式演示场景", { exact: true }).click();
    await page
      .getByRole("button", {
        name: refusal ? "演示安全拒绝" : "演示格式更正",
        exact: true,
      })
      .click();
    const first = page.getByTestId("ideation-stream").first();
    await expect(first).toHaveText("尚未完成的旧尝试。");
    await expect(first).toHaveText("");
    const expected = refusal
      ? "这部分属于平台内部设置，我没法提供。我们继续聊你的故事吧。"
      : "更正后的思路：让渡河的决定留在人物手中。";
    await expect(first).toHaveText(expected);
    await page
      .getByRole("button", { name: "演示格式更正", exact: true })
      .click();
    await expect(page.getByTestId("ideation-stream")).toHaveCount(2);
    await expect(first).toHaveText(expected);
    await page
      .getByLabel("构思会话", { exact: true })
      .selectOption({ label: "渡河之前" });
    await expect(page.getByTestId("ideation-stream")).toHaveCount(0);
    await page
      .getByRole("button", { name: "演示格式更正", exact: true })
      .click();
    await expect(page.getByTestId("ideation-stream")).toHaveCount(1);
    await page
      .getByLabel("构思会话", { exact: true })
      .selectOption({ label: "北岸冬信" });
    await expect(page.getByTestId("ideation-stream")).toHaveCount(2);
    await expect(first).toHaveText(expected);
    await expect(page.getByTestId("ideation-stream").nth(1)).toHaveText(
      "更正后的思路：让渡河的决定留在人物手中。",
    );
  });
}

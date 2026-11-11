import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type {
  IdeationErrorCode,
  IdeationEvent,
  IdeationEventData,
  IdeationRunId,
  IdeationSessionId,
  IdeationTask,
} from "@ruwen/pipeline";
import { createIdeationDemo } from "../src/components/ideation/demo.ts";
import {
  IDEATION_ENDPOINTS,
  ideationHttpStatus,
} from "../src/server/ideation-api.ts";

/** UI boundary fixtures only. The persistence journey and all authorization tests use real services. */
export async function ideationHttpFixture(page: Page, projectId: string) {
  const demo = createIdeationDemo(
    projectId,
    { resetMs: 60, responseMs: 120, chunkMs: 2 },
    8000,
  );
  const extraTasks: IdeationTask[] = [];
  let cursor = 0,
    fail: IdeationErrorCode | undefined;
  await page.addInitScript(() => {
    class ControlledSource extends EventTarget {
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        window.addEventListener("test:ideation", this.deliver);
      }
      deliver = (event: Event) => {
        const detail = (event as CustomEvent).detail;
        if (new URL(this.url, location.origin).pathname === detail.path)
          this.dispatchEvent(
            new MessageEvent(detail.data.type, {
              data: JSON.stringify(detail.data),
              lastEventId: detail.data.id,
            }),
          );
      };
      close() {
        window.removeEventListener("test:ideation", this.deliver);
      }
    }
    Object.defineProperty(window, "EventSource", { value: ControlledSource });
  });
  const deliver = async (event: IdeationEvent) => {
    await page.evaluate(
      (data) =>
        window.dispatchEvent(
          new CustomEvent("test:ideation", {
            detail: {
              path: `/api/projects/${data.projectId}/ideation/sessions/${data.sessionId}/events`,
              data,
            },
          }),
        ),
      event,
    );
  };
  const emit = async (
    sessionId: IdeationSessionId,
    runId: IdeationRunId,
    data: IdeationEventData,
    id?: string,
  ) => {
    const event = {
      ...data,
      version: 1,
      id: id ?? String(++cursor),
      projectId,
      sessionId,
      runId,
      createdAt: new Date().toISOString(),
    } as IdeationEvent;
    await deliver(event);
    return event.id;
  };
  const unsubscribe = demo.subscribe((event) => {
    void deliver({ ...event, id: String(++cursor) as never }).catch(() => {});
  });
  await page.route(
    `**/api/projects/${projectId}/ideation/**`,
    async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        suffix = url.pathname.split("/ideation")[1] ?? "";
      const endpoint = IDEATION_ENDPOINTS.find(
        (e) =>
          e.method === request.method() &&
          new RegExp(`^${e.path.replace(/:[A-Za-z]+/g, "([^/]+)")}$`).test(
            suffix,
          ),
      );
      if (!endpoint) {
        await route.fallback();
        return;
      }
      const input: Record<string, unknown> =
        request.method() === "GET"
          ? Object.fromEntries(url.searchParams)
          : (request.postDataJSON() ?? {});
      if (input.limit !== undefined) input.limit = Number(input.limit);
      if (endpoint.locator) {
        const pattern = new RegExp(
          `^${endpoint.path.replace(/:[A-Za-z]+/g, "([^/]+)")}$`,
        );
        input[endpoint.locator] = pattern.exec(suffix)?.[1];
      }
      if (fail && endpoint.operation === "sendIdeationMessage") {
        const code = fail;
        fail = undefined;
        await route.fulfill({
          status: ideationHttpStatus(code),
          json: {
            ok: false,
            error: {
              code,
              message: "fixture",
              retryable: false,
              traceId: "ui-fixture",
              issues: [],
            },
          },
        });
        return;
      }
      const result = await demo.api[endpoint.operation](input as never);
      if (
        result.ok &&
        endpoint.operation === "listIdeationTasks" &&
        "items" in result.value
      ) {
        await route.fulfill({
          json: {
            ok: true,
            value: {
              ...result.value,
              items: [
                ...result.value.items,
                ...extraTasks.filter((t) => t.sessionId === input.sessionId),
              ],
            },
          },
        });
        return;
      }
      await route.fulfill({
        status: result.ok
          ? endpoint.accepted
            ? 202
            : 200
          : ideationHttpStatus(result.error.code),
        json: result,
      });
    },
  );
  return {
    demo,
    emit,
    failNextSend(code: IdeationErrorCode) {
      fail = code;
    },
    async addRun(sessionId: IdeationSessionId) {
      const runId = randomUUID() as IdeationRunId;
      extraTasks.push({
        id: runId,
        projectId: projectId as never,
        sessionId,
        role: "chuangyi-xietiaoyuan",
        stage: "coordinator",
        status: "RUNNING",
        sourcePreviewId: null,
        outputPreviewIds: [],
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: null,
        },
        error: null,
        createdAt: new Date().toISOString(),
        finishedAt: null,
      });
      await emit(sessionId, runId, {
        type: "task_changed",
        taskId: runId,
        status: "RUNNING",
      });
      return runId;
    },
    dispose() {
      unsubscribe();
      demo.dispose();
    },
  };
}

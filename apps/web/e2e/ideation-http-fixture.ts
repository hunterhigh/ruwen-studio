import { createHash, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import type {
  IdeationApprovalReceipt,
  IdeationCreateVerbatimPreview,
  IdeationErrorCode,
  IdeationEvent,
  IdeationEventData,
  IdeationRunId,
  IdeationSessionId,
  IdeationTask,
  IdeationVerbatimPreview,
} from "@ruwen/pipeline";
import { createIdeationDemo } from "../src/components/ideation/demo.ts";
import {
  fixtureBrand as b,
  fixtureResource,
  previewFixture,
} from "../src/components/ideation/fixtures.ts";
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
  const verbatim: IdeationVerbatimPreview[] = [];
  const verbatimRequests: IdeationCreateVerbatimPreview[] = [];
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
      const literal = /^\/messages\/([^/]+)\/verbatim-previews$/.exec(suffix);
      if (literal && request.method() === "POST") {
        const input = {
          ...request.postDataJSON(),
          messageId: literal[1],
        } as IdeationCreateVerbatimPreview;
        verbatimRequests.push(input);
        const sessions = await demo.api.listIdeationSessions({});
        if (!sessions.ok) throw new Error("fixture sessions");
        for (const session of sessions.value.items) {
          const messages = await demo.api.listIdeationMessages({
            sessionId: session.id,
          });
          const source =
            messages.ok &&
            messages.value.items.find(
              (m) => m.id === input.messageId && m.role === "user",
            );
          if (!source) continue;
          const text = Array.from(source.content)
            .slice(input.start, input.end)
            .join("");
          const base = previewFixture(
            "handoff",
            projectId,
            session.id,
            b(randomUUID()),
          );
          const sha = b<typeof base.sha256>(
            createHash("sha256").update(text).digest("hex"),
          );
          const preview: IdeationVerbatimPreview = {
            ...base,
            kind: "verbatim",
            origin: "user_explicit",
            role: "chuangyi-xietiaoyuan",
            taskId: null,
            summary: b("请阅读逐字选区和写入目标"),
            text: b(text),
            textSha256: sha,
            characterCount: Array.from(text).length,
            source: {
              messageId: source.id,
              start: input.start,
              end: input.end,
              messageSha256: sha,
            },
            target:
              input.target.kind === "current_chapter"
                ? {
                    kind: "current_chapter",
                    chapter: "001",
                    file: {
                      path: b("authoring-ruwen-v5/exact-text/001.md"),
                      sha256: sha,
                    },
                    manifest: {
                      path: b(
                        "authoring-ruwen-v5/manifests/author-manifest.json",
                      ),
                      sha256: sha,
                    },
                    previousExactText: null,
                    maximumCharacters: 600,
                    maximumPacketCharacters: 8000,
                  }
                : {
                    kind: "resource_file",
                    resource: {
                      ...fixtureResource,
                      id: input.target.resourceId,
                    },
                    writeMode: "append",
                    separator: "\n",
                    afterSha256: sha,
                  },
          };
          verbatim.unshift(preview);
          await route.fulfill({
            status: 201,
            json: { ok: true, value: preview },
          });
          return;
        }
        throw new Error("Unknown user fixture message");
      }
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
      const literalIndex = verbatim.findIndex((p) => p.id === input.previewId);
      const literalPreview = verbatim[literalIndex];
      if (literalPreview) {
        if (endpoint.operation === "getPreview") {
          await route.fulfill({ json: { ok: true, value: literalPreview } });
          return;
        }
        if (
          endpoint.operation === "approvePreview" ||
          endpoint.operation === "rejectPreview"
        ) {
          const approved = endpoint.operation === "approvePreview";
          verbatim[literalIndex] = {
            ...literalPreview,
            status: approved ? "approved" : "rejected",
          };
          const receipt: IdeationApprovalReceipt = {
            id: b(randomUUID()),
            projectId: literalPreview.projectId,
            previewId: literalPreview.id,
            approvedSha256: literalPreview.sha256,
            coreApprovals: [],
            startedTaskId: null,
            committedFiles: [],
            projectionRegistered: false,
            createdAt: new Date().toISOString(),
          };
          await route.fulfill({
            json: {
              ok: true,
              value: approved
                ? receipt
                : {
                    previewId: literalPreview.id,
                    status: "rejected",
                    coordinatorMessageId: null,
                  },
            },
          });
          return;
        }
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
      if (endpoint.operation === "createVerbatimPreview")
        throw new Error(
          "Verbatim fixture path must be handled before legacy dispatch",
        );
      const result = await demo.api[endpoint.operation](input as never);
      if (
        result.ok &&
        endpoint.operation === "listPreviews" &&
        "items" in result.value
      ) {
        await route.fulfill({
          json: {
            ok: true,
            value: {
              ...result.value,
              items: [
                ...verbatim.filter((p) => p.sessionId === input.sessionId),
                ...result.value.items,
              ],
            },
          },
        });
        return;
      }
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
    verbatimRequests,
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

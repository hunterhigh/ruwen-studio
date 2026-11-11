import { randomUUID } from "node:crypto";
import { exportProjectZip, importProjectZip } from "@ruwen/core";
import { PostgresFS } from "@ruwen/db";
import { afterEach, expect, it } from "vitest";
import { fixture } from "../../worker/test/helpers.ts";
import { API_ROUTES, handleApi } from "../src/server/api.ts";
import { createWebAuth } from "../src/server/auth.ts";
import type { WebServices } from "../src/server/services.ts";
import { loginFixture } from "./auth-fixture.ts";
import { ideationFixture } from "./ideation-fixture.ts";

const origin = "https://localhost:3000",
  csrf = "f".repeat(64),
  cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  const p = await fixture();
  cleanup.push(() => p.service.stop());
  const otherUser = randomUUID(),
    otherProject = randomUUID();
  await p.service.db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    otherUser,
    `${otherUser}@test.invalid`,
  ]);
  await p.service.db.pool.query(
    "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'demo-ruwen','other')",
    [otherProject, otherUser],
  );
  await importProjectZip(
    new PostgresFS(p.service.db, otherProject, otherUser),
    await exportProjectZip(p.fs),
  );
  const environment = {
    baseURL: origin,
    secret: "ideation-http-test-secret-".repeat(3),
    workspaceRoot: ".",
    preview: true,
  };
  const services: WebServices = {
    worker: p.service,
    auth: createWebAuth(p.service.db, environment),
    environment,
    ipProofSecret: "test",
    adminEmails: [],
  };
  const login = await loginFixture(services, `${p.fs.ownerId}@test.invalid`);
  const own = await ideationFixture(p.service, p.fs.projectId, p.fs.ownerId),
    foreign = await ideationFixture(p.service, otherProject, otherUser);
  const request = (
    url: string,
    method = "GET",
    body?: unknown,
    options: {
      anonymous?: boolean;
      csrf?: boolean;
      headers?: HeadersInit;
    } = {},
  ) =>
    new Request(origin + url, {
      method,
      headers: {
        origin,
        cookie: `__Host-ruwen.csrf=${csrf}; ${options.anonymous ? "" : login.cookie}`,
        "x-csrf-token": options.csrf === false ? "" : csrf,
        ...options.headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const base = `/api/projects/${p.fs.projectId}/ideation`;
  const call = (
    suffix: string,
    method = "GET",
    body?: unknown,
    options?: Parameters<typeof request>[3],
  ) => handleApi(request(base + suffix, method, body, options), services);
  return {
    ...p,
    own,
    foreign,
    services,
    request,
    call,
    otherProject,
    otherUser,
    base,
  };
}

it("all eighteen routes authenticate, guard every path locator (including wrong parent), require CSRF, and reject without creating tasks, model intents or debits", async () => {
  const p = await setup(),
    db = p.service.db;
  const counts = async () =>
    (
      await db.pool.query(
        "SELECT (SELECT count(*) FROM pipeline_runs)::int tasks,(SELECT count(*) FROM role_runs)::int models,(SELECT count(*) FROM credit_ledger)::int ledger",
      )
    ).rows[0];
  const before = await counts();
  const routes = API_ROUTES.filter((r) => r.ideation);
  expect(routes).toHaveLength(18);
  for (const route of routes) {
    const ids = { projectId: p.fs.projectId, ...p.own.ids };
    const path = (values: Record<string, string>) =>
      route.pattern.replace(
        /:([A-Za-z]+)/g,
        (_, key: string) => values[key] ?? "missing",
      );
    const body = route.method === "POST" ? {} : undefined;
    expect(
      (
        await handleApi(
          p.request(path(ids), route.method, body, { anonymous: true }),
          p.services,
        )
      ).status,
      route.pattern,
    ).toBe(401);
    for (const key of route.resourceParams ?? []) {
      const foreign = {
        ...ids,
        [key]:
          key === "projectId"
            ? p.otherProject
            : p.foreign.ids[key as keyof typeof p.foreign.ids],
      };
      const response = await handleApi(
        p.request(path(foreign), route.method, body),
        p.services,
      );
      expect(response.status, `${route.pattern} foreign ${key}`).toBe(404);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(
        (
          await handleApi(
            p.request(
              path({ ...ids, [key]: randomUUID() }),
              route.method,
              body,
            ),
            p.services,
          )
        ).status,
      ).toBe(404);
    }
    if (route.method === "POST")
      expect(
        (
          await handleApi(
            p.request(path(ids), route.method, {}, { csrf: false }),
            p.services,
          )
        ).status,
        route.pattern,
      ).toBe(403);
  }
  expect(await counts()).toEqual(before);
  expect(
    (
      await db.pool.query("SELECT status FROM ideation_previews WHERE id=$1", [
        p.foreign.ids.previewId,
      ])
    ).rows[0]?.status,
  ).toBe("approved");
}, 30000);

it("HTTP persists exact messages, accepts idempotently, approves a real handoff, reads its receipt and cancels only its own task; closed sessions keep results", async () => {
  const p = await setup();
  const created = await p.call("/sessions", "POST", {
    title: "持久化HTTP会话",
    clientRequestId: randomUUID(),
  });
  expect(created.status).toBe(200);
  const session = (await created.json()).value;
  const content = "  HTTP原始措辞天地玄黄宇宙洪荒\r\n日月盈昃辰宿列张  ";
  const message = {
    content,
    expectedSessionRevision: 0,
    clientRequestId: randomUUID(),
  };
  const send = () =>
    p.call(`/sessions/${session.id}/messages`, "POST", message);
  const accepted = await send();
  expect(accepted.status).toBe(202);
  const sent = (await accepted.json()).value;
  expect((await (await send()).json()).value).toEqual(sent);
  expect(
    (await (await p.call(`/sessions/${session.id}/messages`)).json()).value
      .items[0].content,
  ).toBe(content);
  await p.service.handle({
    kind: "ideation",
    projectId: p.fs.projectId,
    ownerId: p.fs.ownerId,
    runId: sent.turnId,
  });
  const preview = (
    await (await p.call(`/sessions/${session.id}/previews`)).json()
  ).value.items[0];
  expect(preview.kind).toBe("handoff");
  const approveBody = {
    confirmed: true,
    expectedSha256: preview.sha256,
    clientRequestId: randomUUID(),
  };
  const approved = await p.call(
    `/previews/${preview.id}/approve`,
    "POST",
    approveBody,
  );
  expect(approved.status).toBe(200);
  const receipt = (await approved.json()).value;
  expect(receipt.startedTaskId).toBeTruthy();
  expect(
    (await (await p.call(`/decisions/${receipt.id}`)).json()).value,
  ).toEqual(receipt);
  expect(
    (await (await p.call(`/previews/${preview.id}`)).json()).value.status,
  ).toBe("approved");
  const close = await p.call(`/sessions/${session.id}/close`, "POST", {
    clientRequestId: randomUUID(),
  });
  expect(close.status).toBe(200);
  const denied = await p.call(`/sessions/${session.id}/messages`, "POST", {
    ...message,
    clientRequestId: randomUUID(),
    expectedSessionRevision: sent.sessionRevision,
  });
  expect(denied.status).toBe(409);
  expect((await denied.json()).error.code).toBe("SESSION_CLOSED");
  expect((await p.call(`/sessions/${session.id}/messages`)).status).toBe(200);
  expect((await p.call(`/sessions/${session.id}/tasks`)).status).toBe(200);
  const cancelled = await p.call(
    `/tasks/${receipt.startedTaskId}/cancel`,
    "POST",
    { clientRequestId: randomUUID() },
  );
  expect(cancelled.status).toBe(200);
  expect(
    (await (await p.call(`/tasks/${receipt.startedTaskId}`)).json()).value
      .status,
  ).toBe("CANCELLED");
}, 30000);

it.each([
  "session_revoked",
  "ownership_removed",
] as const)("SSE replays exclusive Last-Event-ID in order (delta/reset/delta) and stops after %s", async (kind) => {
  const p = await setup(),
    db = p.service.db;
  const event = async (data: unknown) =>
    (
      await db.pool.query<{ id: string }>(
        "INSERT INTO ideation_events(project_id,session_id,run_id,data) VALUES($1,$2,$3,$4) RETURNING id::text",
        [
          p.fs.projectId,
          p.own.ids.sessionId,
          p.own.ids.taskId,
          JSON.stringify(data),
        ],
      )
    ).rows[0]?.id ?? "0";
  const old = await event({
    type: "delta",
    role: "chuangyi-xietiaoyuan",
    text: "OLD_SAFE_PREFIX",
  });
  const reset = await event({
    type: "reset",
    role: "chuangyi-xietiaoyuan",
    reason: "format_correction",
  });
  const next = await event({
    type: "delta",
    role: "chuangyi-xietiaoyuan",
    text: "NEW_SAFE\n原始分行",
  });
  await db.pool.query(
    "INSERT INTO ideation_events(project_id,session_id,run_id,data) VALUES($1,$2,$3,$4)",
    [
      p.otherProject,
      p.foreign.ids.sessionId,
      p.foreign.ids.taskId,
      JSON.stringify({
        type: "delta",
        role: "chuangyi-xietiaoyuan",
        text: "FOREIGN_SENTINEL",
      }),
    ],
  );
  const response = await p.call(
    `/sessions/${p.own.ids.sessionId}/events?after=${next}`,
    "GET",
    undefined,
    { headers: { "last-event-id": old } },
  );
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE");
  try {
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain(`id: ${reset}\n`);
    expect(first).toContain("event: reset");
    const second = new TextDecoder().decode((await reader.read()).value);
    expect(second).toContain(`id: ${next}\n`);
    expect(second).toContain("NEW_SAFE\\n原始分行");
    expect(first + second).not.toContain("FOREIGN_SENTINEL");
    await event({
      type: "delta",
      role: "chuangyi-xietiaoyuan",
      text: "AFTER_REVOCATION_SENTINEL",
    });
    if (kind === "session_revoked")
      await db.pool.query("DELETE FROM auth_sessions WHERE user_id=$1", [
        p.fs.ownerId,
      ]);
    else
      await db.pool.query("UPDATE projects SET owner_id=$2 WHERE id=$1", [
        p.fs.projectId,
        p.otherUser,
      ]);
    expect((await reader.read()).done).toBe(true);
  } finally {
    await reader.cancel();
  }
}, 30000);

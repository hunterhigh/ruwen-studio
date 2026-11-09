import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createFauxRuntime } from "@ruwen/agents";
import { importProjectZip, LeakDetector, LocalDirFS } from "@ruwen/core";
import { PostgresFS } from "@ruwen/db";
import { afterEach, expect, it } from "vitest";
import { runtimeSettings } from "../../../config/settings.ts";
import { defaultFauxResponse } from "../../../packages/agents/src/faux.ts";
import { deploymentCanary } from "../../../packages/agents/src/security/notes.ts";
import { API_ROUTES, handleApi } from "../../web/src/server/api.ts";
import {
  createWebAuth,
  seedPreviewInvitation,
} from "../../web/src/server/auth.ts";
import { CSRF_COOKIE } from "../../web/src/server/security.ts";
import type { WebServices } from "../../web/src/server/services.ts";
import { fixture } from "./helpers.ts";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup(blocked = false) {
  const workspaceRoot = await mkdtemp(
    path.join(tmpdir(), "ruwen-api-prompts-"),
  );
  const resolved = path.resolve(workspaceRoot);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith("ruwen-api-prompts-")
  )
    throw new Error("Unsafe API fixture path");
  cleanup.push(() =>
    rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }),
  );
  const p = await fixture(
    blocked
      ? {
          runtime: () =>
            createFauxRuntime([
              (context) => ({
                ...defaultFauxResponse(context),
                content: [{ type: "text", text: deploymentCanary() }],
                stopReason: "stop",
              }),
            ]),
        }
      : {},
  );
  cleanup.push(() => p.service.stop());
  const origin = "https://localhost:3000",
    csrf = "b".repeat(64);
  const environment = {
    baseURL: origin,
    secret: "privacy-test-secret-".repeat(4),
    workspaceRoot,
    preview: true,
  };
  const services: WebServices = {
    worker: p.service,
    auth: createWebAuth(p.service.db, environment),
    environment,
    ipProofSecret: "test-proof",
    adminEmails: [],
  };
  let sessionCookie = "";
  const request = (
    url: string,
    method = "GET",
    body?: unknown,
    cookieOverride?: string,
  ) =>
    new Request(origin + url, {
      method,
      headers: {
        origin,
        "content-type": "application/json",
        cookie: cookieOverride ?? `${CSRF_COOKIE}=${csrf}; ${sessionCookie}`,
        "x-csrf-token": csrf,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const initial: unknown[] = [];
  await seedPreviewInvitation(p.service.db);
  const login = await handleApi(
    request("/api/login", "POST", {
      email: `${randomUUID()}@test.invalid`,
      invitationCode: runtimeSettings().preview.invitationCode,
    }),
    services,
  );
  expect(login.status).toBe(200);
  initial.push(await login.json());
  const mailbox = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  const mail = await handleApi(
    request("/api/preview/mail", "GET", undefined, mailbox),
    services,
  );
  const link = (await mail.json()) as { url: string };
  initial.push(link);
  const verified = await services.auth.handler(new Request(link.url));
  expect(verified.status).toBe(302);
  sessionCookie = verified.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  const session = await services.auth.api.getSession({
    headers: new Headers({ cookie: sessionCookie }),
  });
  if (!session) throw new Error("Missing test session");
  await p.service.db.pool.query("UPDATE projects SET owner_id=$1 WHERE id=$2", [
    session.user.id,
    p.fs.projectId,
  ]);
  const fs = new PostgresFS(p.service.db, p.fs.projectId, session.user.id);
  const queued = await handleApi(
    request(`/api/projects/${fs.projectId}/chapters`, "POST", { chapter: 1 }),
    services,
  );
  expect(queued.status).toBe(202);
  const id = (await queued.json()).id as string;
  const run = await p.service.handle({
    kind: "chapter",
    projectId: fs.projectId,
    ownerId: fs.ownerId,
    runId: id,
  });
  expect(run?.status).toBe(blocked ? "FAILED" : "AWAITING_CANDIDATE_APPROVAL");
  const rows = await p.service.db.pool.query(
    "SELECT p.content,r.transcript FROM role_runs r JOIN prompts p ON p.sha256=r.prompt_sha256 WHERE run_id=$1",
    [id],
  );
  const materials = rows.rows.flatMap((row) =>
    row.transcript.filter((message: { role: string }) =>
      ["user", "toolResult"].includes(message.role),
    ),
  );
  const guards = rows.rows.map(
    (row) => new LeakDetector(row.content, deploymentCanary(), materials),
  );
  const safe = (value: unknown) => {
    for (const guard of guards) expect(guard.check(value)).toBeUndefined();
  };
  safe(initial);
  return { services, fs, id, request, safe, workspaceRoot };
}
it("every registered HTTP response, file read, export entry and SSE batch excludes private prompt windows and canaries", async () => {
  const { services, fs, id, request, safe, workspaceRoot } = await setup();
  // Exercise every file body before POST routes can change the test run's state.
  for (const p of await fs.list()) {
    const response = await handleApi(
      request(
        `/api/projects/${fs.projectId}/files?path=${encodeURIComponent(p)}`,
      ),
      services,
    );
    expect(response.status).toBe(200);
    safe(await response.json());
  }
  for (const route of API_ROUTES) {
    const url = route.pattern
      .replace(":projectId", fs.projectId)
      .replace(":runId", id);
    expect(url).not.toMatch(/:[A-Za-z]/); // New resource parameters need a concrete privacy fixture.
    const response = await handleApi(
      request(url, route.method, route.method === "POST" ? {} : undefined),
      services,
    );
    safe([...response.headers]);
    if (route.pattern.endsWith("/export")) {
      expect(response.status).toBe(200);
      const imported = new LocalDirFS(
        path.join(workspaceRoot, "exported-project"),
      );
      await importProjectZip(
        imported,
        new Uint8Array(await response.arrayBuffer()),
      );
      for (const p of await imported.list()) safe(await imported.readText(p));
    } else if (route.pattern.endsWith("/events")) {
      expect(response.status).toBe(200);
      const events = await services.worker.db.pool.query(
        "SELECT delta FROM web_run_events WHERE run_id=$1",
        [id],
      );
      safe(events.rows);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Missing SSE body");
      try {
        for (let n = 0; n < Math.min(events.rowCount ?? 0, 256) + 2; n++)
          safe(new TextDecoder().decode((await reader.read()).value));
      } finally {
        await reader.cancel();
      }
    } else safe(await response.text());
  }
  expect(
    (
      await handleApi(
        request(
          `/api/projects/${fs.projectId}/files?path=${encodeURIComponent("authoring-ruwen-v5/reports/prompts/nonexistent.txt")}`,
        ),
        services,
      )
    ).status,
  ).toBe(404);
  expect((await handleApi(request("/api/prompts"), services)).status).toBe(404);
}, 30000);
it("an intercepted model response reaches neither real run-detail APIs nor persistent/replayed SSE", async () => {
  const { services, id, request, safe } = await setup(true);
  const detail = await handleApi(request(`/api/runs/${id}`), services);
  expect(detail.status).toBe(200);
  safe(await detail.json());
  expect(
    (
      await services.worker.db.pool.query(
        "SELECT id FROM web_run_events WHERE run_id=$1",
        [id],
      )
    ).rowCount,
  ).toBe(0);
  const response = await handleApi(request(`/api/runs/${id}/events`), services);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing SSE body");
  try {
    const first = new TextDecoder().decode((await reader.read()).value);
    safe(first);
    expect(first).not.toContain("event: delta");
  } finally {
    await reader.cancel();
  }
}, 30000);

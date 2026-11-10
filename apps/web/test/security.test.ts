import { createHmac, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runtimeSettings } from "../../../config/settings.ts";
import { fixture } from "../../worker/test/helpers.ts";
import { SafeMarkdown } from "../src/components/SafeMarkdown.tsx";
import { API_ROUTES, handleApi } from "../src/server/api.ts";
import {
  createWebAuth,
  newMailbox,
  previewMail,
  seedPreviewInvitation,
} from "../src/server/auth.ts";
import {
  CSRF_COOKIE,
  clientIp,
  cookie,
  hash,
  loginLimit,
  MAILBOX_COOKIE,
  requireCsrf,
  securityHeaders,
} from "../src/server/security.ts";
import type { WebServices } from "../src/server/services.ts";

const origin = "https://localhost:3000",
  token = "a".repeat(64);
let services: WebServices,
  sessionCookie = "",
  projectId = "",
  runId = "";
let ownedProjectId = "",
  ownedRunId = "";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const request = (
  url: string,
  method = "GET",
  authenticated = true,
  headers: HeadersInit = {},
  body?: unknown,
) =>
  new Request(origin + url, {
    method,
    headers: {
      origin,
      cookie: `${CSRF_COOKIE}=${token}; ${authenticated ? sessionCookie : ""}`,
      "x-csrf-token": token,
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
beforeAll(async () => {
  const p = await fixture();
  projectId = p.fs.projectId;
  runId = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  const environment = {
    baseURL: origin,
    secret: "web-test-secret-".repeat(4),
    workspaceRoot: root,
    preview: true,
  };
  services = {
    worker: p.service,
    environment,
    auth: createWebAuth(p.service.db, environment),
    ipProofSecret: "proof",
    adminEmails: [],
  };
  await seedPreviewInvitation(p.service.db);
  const login = await handleApi(
    request(
      "/api/login",
      "POST",
      false,
      {},
      {
        email: `${randomUUID()}@test.invalid`,
        invitationCode: runtimeSettings().preview.invitationCode,
      },
    ),
    services,
  );
  expect(login.status).toBe(200);
  const mailboxCookie = login.headers.getSetCookie()[0]?.split(";")[0] ?? "";
  const mail = await handleApi(
    request("/api/preview/mail", "GET", false, { cookie: mailboxCookie }),
    services,
  );
  const link = (await mail.json()) as { url: string };
  const verified = await services.auth.handler(new Request(link.url));
  expect(verified.status).toBe(302);
  const cookies = verified.headers.getSetCookie();
  expect(
    cookies.some(
      (v) =>
        /HttpOnly/i.test(v) && /Secure/i.test(v) && /SameSite=Lax/i.test(v),
    ),
  ).toBe(true);
  sessionCookie = cookies.map((v) => v.split(";")[0]).join("; ");
  expect((await handleApi(request("/api/session"), services)).status).toBe(200);
  const created = await handleApi(
    request(
      "/api/projects",
      "POST",
      true,
      {},
      { title: "owned test", mode: "demo", owner_id: "foreign-ignored" },
    ),
    services,
  );
  expect(created.status).toBe(201);
  ownedProjectId = (await created.json()).id as string;
  const queued = await handleApi(
    request(
      `/api/projects/${ownedProjectId}/chapters`,
      "POST",
      true,
      {},
      { chapter: 1 },
    ),
    services,
  );
  expect(queued.status).toBe(202);
  ownedRunId = (await queued.json()).id as string;
}, 20000);
afterAll(async () => {
  await services?.worker.stop();
});

it("every private route rejects anonymous requests; owner mutations also need CSRF", async () => {
  const publicRoutes = new Set([
    "/api/health",
    "/api/csrf",
    "/api/login",
    "/api/preview/mail",
  ]);
  for (const route of API_ROUTES.filter((r) => !publicRoutes.has(r.pattern))) {
    const url = route.pattern
      .replace(":projectId", ownedProjectId)
      .replace(":runId", ownedRunId);
    expect(
      (
        await handleApi(
          request(
            url,
            route.method,
            false,
            {},
            route.method === "POST" ? {} : undefined,
          ),
          services,
        )
      ).status,
      url,
    ).toBe(401);
    if (route.resource && route.method === "POST")
      expect(
        (
          await handleApi(
            request(url, "POST", true, { "x-csrf-token": "" }, {}),
            services,
          )
        ).status,
        url,
      ).toBe(403);
  }
  const projects = (await (
    await handleApi(request("/api/projects"), services)
  ).json()) as { id: string }[];
  expect(projects.map((p) => p.id)).toContain(ownedProjectId);
  expect(projects.map((p) => p.id)).not.toContain(projectId);
  expect((await handleApi(request("/api/admin"), services)).status).toBe(404);
});
it("own SSE resumes durable deltas after event ID and never includes another tenant", async () => {
  const db = services.worker.db;
  await db.pool.query(
    "INSERT INTO web_run_events(project_id,run_id,role_id,delta) VALUES($1,$2,'xiaoshuo-zuozhe','FOREIGN_STREAM_SENTINEL')",
    [projectId, runId],
  );
  const first = await db.pool.query<{ id: string }>(
    "INSERT INTO web_run_events(project_id,run_id,role_id,delta) VALUES($1,$2,'xiaoshuo-zuozhe','FIRST_OWN_DELTA') RETURNING id",
    [ownedProjectId, ownedRunId],
  );
  await db.pool.query(
    "INSERT INTO web_run_events(project_id,run_id,role_id,delta) VALUES($1,$2,'xiaoshuo-zuozhe','RESUMED_OWN_DELTA')",
    [ownedProjectId, ownedRunId],
  );
  const response = await handleApi(
    request(`/api/runs/${ownedRunId}/events`, "GET", true, {
      "last-event-id": first.rows[0]?.id ?? "0",
    }),
    services,
  );
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  const item = await reader?.read();
  const chunk = new TextDecoder().decode(item?.value);
  await reader?.cancel();
  expect(chunk).toContain("RESUMED_OWN_DELTA");
  expect(chunk).not.toMatch(/FIRST_OWN_DELTA|FOREIGN_STREAM_SENTINEL/);
});
it("valid CSRF cannot approve or return a queued run before a candidate exists", async () => {
  for (const action of ["return", "approve-candidate", "approve-memory"]) {
    const response = await handleApi(
      request(
        `/api/runs/${ownedRunId}/${action}`,
        "POST",
        true,
        {},
        {
          reason: "too early",
          confirmed: true,
          expectedSha256: "a".repeat(64),
        },
      ),
      services,
    );
    expect(response.status).toBe(409);
  }
  expect(
    (
      await services.worker.db.pool.query(
        "SELECT status FROM pipeline_runs WHERE id=$1",
        [ownedRunId],
      )
    ).rows[0]?.status,
  ).toBe("REQUESTED");
});

for (const route of API_ROUTES.filter((item) => item.resource)) {
  it(`I13: A cannot access B: ${route.method} ${route.pattern} (${route.foreignCase})`, async () => {
    const url = route.pattern
      .replace(":projectId", projectId)
      .replace(":runId", runId);
    const result = await handleApi(
      request(
        url,
        route.method,
        true,
        {},
        route.method === "GET"
          ? undefined
          : { confirmed: true, reason: "foreign" },
      ),
      services,
    );
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ error: "资源不存在。" });
  });
}
it("CI route coverage: every resource parameter declares and runs a foreign ownership case; no unregistered route files", async () => {
  for (const route of API_ROUTES) {
    const params = route.pattern.match(/:[A-Za-z]+/g) ?? [];
    if (params.length) {
      expect(params).toEqual([`:${route.resource}`]);
      expect(route.foreignCase).toBeTruthy();
    } else expect(route.resource).toBeUndefined();
  }
  const files: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) await visit(path.join(directory, entry.name));
      else if (/^route\.[jt]sx?$/.test(entry.name))
        files.push(
          path
            .relative(
              path.join(root, "apps/web/src/app/api"),
              path.join(directory, entry.name),
            )
            .replaceAll("\\", "/"),
        );
    }
  }
  await visit(path.join(root, "apps/web/src/app/api"));
  expect(files.sort()).toEqual([
    "[...route]/route.ts",
    "auth/[...all]/route.ts",
  ]);
});
it("all mutation routes reject missing CSRF before effects, including billing and login", async () => {
  for (const route of API_ROUTES.filter(
    (r) => r.method === "POST" && !r.resource,
  )) {
    const response = await handleApi(
      request(route.pattern, "POST", true, { "x-csrf-token": "" }, {}),
      services,
    );
    expect(response.status, route.pattern).toBe(403);
  }
  expect(() =>
    requireCsrf(
      request("/api/projects", "POST", true, {
        origin: "https://evil.invalid",
      }),
      origin,
    ),
  ).toThrow();
  expect(() =>
    requireCsrf(
      request("/api/projects", "POST", true, {
        "sec-fetch-site": "cross-site",
      }),
      origin,
    ),
  ).toThrow();
  expect(() =>
    requireCsrf(
      request("/api/projects", "POST", true, {
        "x-csrf-token": "b".repeat(64),
      }),
      origin,
    ),
  ).toThrow();
  expect(() =>
    requireCsrf(request("/api/projects", "POST"), origin),
  ).not.toThrow();
});
it("safe Markdown drops HTML/images and unsafe links; https links always carry all rel protections", () => {
  const rendered = renderToStaticMarkup(
    createElement(SafeMarkdown, {
      content:
        '<script>alert(1)</script>\n<img src="https://tracker.invalid/pixel">\n\n![追踪](https://tracker.invalid/image)\n\n[坏](http://evil.invalid) [脚本](javascript:alert) [站内](/account) [安全](https://example.com/read)',
    }),
  );
  expect(rendered).not.toMatch(
    /<script|<img|href="http:|href="javascript:|href="\/account|src=/,
  );
  expect(rendered).toContain('href="https://example.com/read"');
  expect(rendered).toContain('rel="noopener noreferrer nofollow"');
  const plain = renderToStaticMarkup(
    createElement(SafeMarkdown, { plain: true, content: "<script>x</script>" }),
  );
  expect(plain).toContain("&lt;script&gt;");
});
it("only the safe component imports Markdown; lint forbids the raw HTML escape hatch", async () => {
  const config = JSON.parse(
    await readFile(path.join(root, "biome.json"), "utf8"),
  );
  expect(config.linter.rules.security.noDangerouslySetInnerHtml).toBe("error");
  async function inspect(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (/\.[jt]sx?$/.test(entry.name)) {
        const content = await readFile(file, "utf8");
        if (content.includes('from "react-markdown"'))
          expect(entry.name).toBe("SafeMarkdown.tsx");
        expect(content).not.toContain("dangerously" + "SetInnerHTML");
      }
    }
  }
  await inspect(path.join(root, "apps/web/src"));
});
it("CSP is nonce based with no raw inline HTML permission and security headers deny framing", () => {
  const headers = securityHeaders("nonce-test");
  expect(headers["Content-Security-Policy"]).toContain("'nonce-nonce-test'");
  expect(headers["Content-Security-Policy"]).not.toMatch(
    /unsafe-inline|unsafe-eval|https:\/\//,
  );
  expect(headers["Content-Security-Policy"]).toContain("img-src 'self'");
  expect(headers["X-Frame-Options"]).toBe("DENY");
  expect(headers["X-Content-Type-Options"]).toBe("nosniff");
  expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  for (const directive of [
    "default-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ])
    expect(headers["Content-Security-Policy"]).toContain(directive);
  expect(headers["Strict-Transport-Security"]).toContain("max-age=");
  expect(cookie(CSRF_COOKIE, token, 300)).toContain(
    "HttpOnly; Secure; SameSite=Lax",
  );
});
it("login rate limits independently by IP and normalized email; spoofed forwarding headers do not change the trusted IP", async () => {
  const secret = randomUUID(),
    settings = runtimeSettings().security;
  for (let i = 0; i < settings.loginIpLimit; i++)
    await loginLimit(services.worker.db, "ip-one", `${i}@test.invalid`, secret);
  await expect(
    loginLimit(services.worker.db, "ip-one", "other@test.invalid", secret),
  ).rejects.toMatchObject({ status: 429 });
  for (let i = 0; i < settings.loginEmailLimit; i++)
    await loginLimit(
      services.worker.db,
      `another-${i}`,
      "Same@Test.Invalid",
      secret,
    );
  await expect(
    loginLimit(services.worker.db, "different-ip", "same@test.invalid", secret),
  ).rejects.toMatchObject({ status: 429 });
  expect(
    clientIp(
      request("/", "GET", false, {
        "x-forwarded-for": "fake",
        "x-ruwen-client-ip": "fake",
      }),
      "proof",
    ),
  ).toBe("untrusted-ip");
  expect(
    clientIp(
      request("/", "GET", false, {
        "x-ruwen-client-ip": "actual",
        "x-ruwen-ip-proof": createHmac("sha256", "proof")
          .update("actual")
          .digest("hex"),
      }),
      "proof",
    ),
  ).toBe("actual");
});
it("production mailbox cannot be accessed and charging stays server-blocked before P3", async () => {
  expect(
    (
      await handleApi(
        request("/api/billing/checkout", "POST", true, {}, {}),
        services,
      )
    ).status,
  ).toBe(403);
  const production = {
    ...services,
    environment: { ...services.environment, preview: false },
  };
  expect(
    (
      await handleApi(
        request("/api/preview/mail", "GET", false, {
          cookie: `${MAILBOX_COOKIE}=${"b".repeat(64)}`,
        }),
        production,
      )
    ).status,
  ).toBe(404);
});
it("direct authentication cannot create an uninvited user, and mailbox tokens are bound to one browser", async () => {
  const email = `${randomUUID()}@test.invalid`,
    mailbox = newMailbox();
  await services.auth.api.signInMagicLink({
    headers: new Headers({ origin }),
    body: {
      email,
      callbackURL: "/projects",
      metadata: { previewMailbox: hash(mailbox) },
    },
  });
  const mail = await previewMail(services.environment, mailbox);
  await expect(
    previewMail(services.environment, newMailbox()),
  ).rejects.toMatchObject({ status: 404 });
  const denied = await services.auth.handler(new Request(mail.url));
  expect(
    denied.headers
      .getSetCookie()
      .some((value) => value.includes("session_token=")),
  ).toBe(false);
  expect(
    (
      await services.worker.db.pool.query(
        "SELECT id FROM users WHERE email=$1",
        [email],
      )
    ).rowCount,
  ).toBe(0);
});

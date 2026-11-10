import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, expect, it } from "vitest";
import { fixture } from "../../worker/test/helpers.ts";
import { AdminSecurity } from "../src/components/AdminSecurity.tsx";
import { adminRiskReview, auditAdmin } from "../src/server/admin-review.ts";
import { handleApi } from "../src/server/api.ts";
import { createWebAuth } from "../src/server/auth.ts";
import type { WebServices } from "../src/server/services.ts";
import { loginFixture } from "./auth-fixture.ts";

let p: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  p = await fixture();
});
afterAll(async () => {
  await p?.service.stop();
});
const origin = "https://localhost:3000",
  csrf = "a".repeat(64);
it("admin audit stores allowed/denied metadata, is append only and its UI never invents a freeze decision", async () => {
  await auditAdmin(p.service.db.pool, p.fs.ownerId, "dashboard_page", true);
  await auditAdmin(p.service.db.pool, null, "dashboard_data", false);
  const run = await p.service.enqueueChapter(p.fs, { chapter: 1 });
  await p.service.db.pool.query(
    "INSERT INTO security_events(user_id,project_id,run_id,role_id,kind,score) VALUES($1,$2,$3,'xiaoshuo-zuozhe','canary',1)",
    [p.fs.ownerId, p.fs.projectId, run],
  );
  const review = await adminRiskReview(p.service.db);
  expect(review.enforcement).toBe("pending_backend");
  expect(review.accounts.find((row) => row.id === p.fs.ownerId)).toMatchObject({
    score: 1,
    events: 1,
  });
  const own = review.audit.find((entry) => entry.actorId === p.fs.ownerId);
  expect(own?.outcome).toBe("allowed");
  expect(
    review.audit.some(
      (entry) => entry.actorId === null && entry.outcome === "denied",
    ),
  ).toBe(true);
  await expect(
    p.service.db.pool.query(
      "UPDATE web_admin_audit SET outcome='denied' WHERE id=$1",
      [own?.id],
    ),
  ).rejects.toThrow("append only");
  await expect(
    p.service.db.pool.query("DELETE FROM web_admin_audit WHERE id=$1", [
      own?.id,
    ]),
  ).rejects.toThrow("append only");
  const html = renderToStaticMarkup(createElement(AdminSecurity, { review }));
  expect(html).toContain("冻结执行服务尚未接入");
  expect(html).toContain("未知 · 冻结服务未接入");
  expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html).not.toContain("系统提示词全文");
});
it("admin APIs enforce role and CSRF, audit reads and invitation creation atomically, and retain no secret payload", async () => {
  const db = p.service.db,
    environment = {
      baseURL: origin,
      secret: "admin-review-test-".repeat(4),
      workspaceRoot: ".",
      preview: true,
    };
  const auth = createWebAuth(db, environment);
  const user = (
    await db.pool.query<{ email: string }>(
      "SELECT email FROM users WHERE id=$1",
      [p.fs.ownerId],
    )
  ).rows[0];
  if (!user) throw new Error("Missing fixture user");
  const services: WebServices = {
    worker: p.service,
    environment,
    auth,
    ipProofSecret: "test",
    adminEmails: [],
  };
  const login = await loginFixture(services, user.email);
  const req = (path: string, method = "GET", validCsrf = true) =>
    new Request(origin + path, {
      method,
      headers: {
        origin,
        cookie: `__Host-ruwen.csrf=${csrf}; ${login.cookie}`,
        "x-csrf-token": validCsrf ? csrf : "",
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
  expect((await handleApi(req("/api/admin"), services)).status).toBe(404);
  services.adminEmails = [user.email];
  expect(
    (await handleApi(req("/api/admin/freeze", "POST"), services)).status,
  ).toBe(404);
  expect(
    (await handleApi(req("/api/admin/invitations", "POST", false), services))
      .status,
  ).toBe(403);
  const result = await handleApi(req("/api/admin"), services);
  expect(result.status).toBe(200);
  expect((await result.json()).security.enforcement).toBe("pending_backend");
  const invitation = await handleApi(
    req("/api/admin/invitations", "POST"),
    services,
  );
  expect(invitation.status).toBe(200);
  const { code } = (await invitation.json()) as { code: string };
  const audit = await db.pool.query(
    "SELECT * FROM web_admin_audit WHERE actor_id=$1 ORDER BY created_at",
    [p.fs.ownerId],
  );
  expect(audit.rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ action: "dashboard_data", outcome: "denied" }),
      expect.objectContaining({ action: "dashboard_data", outcome: "allowed" }),
      expect.objectContaining({
        action: "invitation_create",
        outcome: "allowed",
      }),
    ]),
  );
  expect(JSON.stringify(audit.rows)).not.toContain(code);
});

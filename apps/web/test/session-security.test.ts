import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runtimeSettings } from "../../../config/settings.ts";
import { fixture } from "../../worker/test/helpers.ts";
import { createWebAuth, newMailbox, previewMail } from "../src/server/auth.ts";
import { handleAuthPost } from "../src/server/auth-request.ts";
import { hash } from "../src/server/security.ts";
import type { WebServices } from "../src/server/services.ts";
import { loginFixture } from "./auth-fixture.ts";

let p: Awaited<ReturnType<typeof fixture>>,
  services: WebServices,
  email = "";
const origin = "https://localhost:3000",
  csrf = "b".repeat(64);
beforeAll(async () => {
  p = await fixture();
  email =
    (
      await p.service.db.pool.query<{ email: string }>(
        "SELECT email FROM users WHERE id=$1",
        [p.fs.ownerId],
      )
    ).rows[0]?.email ?? "";
  const environment = {
    baseURL: origin,
    secret: "session-test-".repeat(5),
    workspaceRoot: ".",
    preview: true,
  };
  services = {
    worker: p.service,
    auth: createWebAuth(p.service.db, environment),
    environment,
    ipProofSecret: "test",
    adminEmails: [],
  };
});
afterAll(async () => {
  await p?.service.stop();
});
it("magic links expire in the configured 15 minutes, are one-use, and successful login rotates the session", async () => {
  const mailbox = newMailbox();
  await services.auth.api.signInMagicLink({
    headers: new Headers({ origin }),
    body: { email, metadata: { previewMailbox: hash(mailbox) } },
  });
  const row = (
    await p.service.db.pool.query<{ expires_at: Date; created_at: Date }>(
      "SELECT expires_at,created_at FROM auth_verifications WHERE value::jsonb->>'email'=$1 ORDER BY created_at DESC LIMIT 1",
      [email],
    )
  ).rows[0];
  if (!row) throw new Error("Missing magic-link fixture");
  expect(
    Math.abs(
      row.expires_at.getTime() -
        row.created_at.getTime() -
        runtimeSettings().security.magicLinkMinutes * 60000,
    ),
  ).toBeLessThan(1000);
  const mail = await previewMail(services.environment, mailbox);
  const first = await services.auth.handler(new Request(mail.url));
  const cookie = first.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const prior = await services.auth.api.getSession({ headers: { cookie } });
  expect(prior?.user.id).toBe(p.fs.ownerId);
  const replay = await services.auth.handler(new Request(mail.url));
  expect(
    replay.headers
      .getSetCookie()
      .some((value) => value.includes("session_token=")),
  ).toBe(false);
  const second = await loginFixture(services, email, cookie);
  const rotated = await services.auth.api.getSession({
    headers: { cookie: second.cookie },
  });
  expect(rotated?.session.id).not.toBe(prior?.session.id);
  expect(rotated?.user.id).toBe(p.fs.ownerId);
});
it("revoke-all endpoint needs CSRF and revokes every own session without touching another user", async () => {
  const a = await loginFixture(services, email),
    b = await loginFixture(services, email);
  const otherId = randomUUID(),
    otherEmail = `${otherId}@test.invalid`;
  await p.service.db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    otherId,
    otherEmail,
  ]);
  const other = await loginFixture(services, otherEmail);
  const request = (valid: boolean) =>
    new Request(`${origin}/api/auth/revoke-sessions`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `__Host-ruwen.csrf=${csrf}; ${a.cookie}`,
        "x-csrf-token": valid ? csrf : "",
      },
      body: "{}",
    });
  expect((await handleAuthPost(request(false), services)).status).toBe(403);
  expect(
    await services.auth.api.getSession({ headers: { cookie: b.cookie } }),
  ).not.toBeNull();
  expect((await handleAuthPost(request(true), services)).status).toBe(200);
  expect(
    await services.auth.api.getSession({ headers: { cookie: a.cookie } }),
  ).toBeNull();
  expect(
    await services.auth.api.getSession({ headers: { cookie: b.cookie } }),
  ).toBeNull();
  expect(
    (await services.auth.api.getSession({ headers: { cookie: other.cookie } }))
      ?.user.id,
  ).toBe(otherId);
});

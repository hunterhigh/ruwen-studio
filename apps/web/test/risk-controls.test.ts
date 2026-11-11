import { randomUUID } from "node:crypto";
import { createFauxRuntime } from "@ruwen/agents";
import { balance } from "@ruwen/billing";
import { afterEach, expect, it } from "vitest";
import { runtimeSettings } from "../../../config/settings.ts";
import { fixture } from "../../worker/test/helpers.ts";
import { handleApi } from "../src/server/api.ts";
import { createWebAuth } from "../src/server/auth.ts";
import { disposableEmail } from "../src/server/email-policy.ts";
import { hash } from "../src/server/security.ts";
import type { WebServices } from "../src/server/services.ts";
import { loginFixture } from "./auth-fixture.ts";

const origin = "https://localhost:3000",
  token = "a".repeat(64),
  cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  const runtime = createFauxRuntime();
  let calls = 0;
  const stream = runtime.models.streamSimple.bind(runtime.models);
  runtime.models.streamSimple = (...args) => {
    calls++;
    return stream(...args);
  };
  const p = await fixture({ runtime: () => runtime });
  cleanup.push(() => p.service.stop());
  const environment = {
    baseURL: origin,
    secret: "risk-controls-test-secret-".repeat(3),
    workspaceRoot: ".",
    preview: true,
  };
  const services: WebServices = {
    worker: p.service,
    auth: createWebAuth(p.service.db, environment),
    environment,
    ipProofSecret: "risk",
    adminEmails: [`${p.fs.ownerId}@test.invalid`],
  };
  const login = await loginFixture(services, `${p.fs.ownerId}@test.invalid`);
  const call = (
    path: string,
    body: unknown,
    options: { csrf?: boolean; anonymous?: boolean } = {},
  ) =>
    handleApi(
      new Request(origin + path, {
        method: "POST",
        headers: {
          origin,
          cookie: `__Host-ruwen.csrf=${token}; ${options.anonymous ? "" : login.cookie}`,
          "x-csrf-token": options.csrf === false ? "" : token,
        },
        body: JSON.stringify(body),
      }),
      services,
    );
  return { ...p, services, call, calls: () => calls };
}
it("daily limit mutation is self-only even for admins, CSRF protected and validated; budget refusal creates no task/model/debit", async () => {
  const p = await setup(),
    db = p.service.db,
    own = `/api/billing/accounts/${p.fs.ownerId}/daily-limit`,
    other = randomUUID();
  await db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    other,
    `${other}@test.invalid`,
  ]);
  expect(
    (await p.call(own, { limitCredits: 20000 }, { anonymous: true })).status,
  ).toBe(401);
  expect(
    (
      await p.call(`/api/billing/accounts/${other}/daily-limit`, {
        limitCredits: 20000,
      })
    ).status,
  ).toBe(404);
  expect(
    (await p.call(own, { limitCredits: 20000 }, { csrf: false })).status,
  ).toBe(403);
  for (const value of [
    -1,
    0,
    1.5,
    runtimeSettings().riskReview.dailyMaximumCredits + 1,
    "500",
  ])
    expect((await p.call(own, { limitCredits: value })).status).toBe(400);
  expect(
    (await p.call(own, { limitCredits: 20000, userId: other })).status,
  ).toBe(400);
  expect((await p.call(own, { limitCredits: 20000 })).status).toBe(200);
  const before = await balance(db.pool, p.fs.ownerId, "sandbox");
  const rejected = await p.call(`/api/projects/${p.fs.projectId}/chapters`, {
    chapter: 1,
  });
  expect(rejected.status).toBe(402);
  expect((await rejected.json()).error.code).toBe("INSUFFICIENT_CREDITS");
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int n FROM pipeline_runs WHERE project_id=$1",
        [p.fs.projectId],
      )
    ).rows[0]?.n,
  ).toBe(0);
  expect(await balance(db.pool, p.fs.ownerId, "sandbox")).toEqual(before);
  expect(p.calls()).toBe(0);
  expect((await p.call(own, { limitCredits: 100000 })).status).toBe(200);
  const accepted = await p.call(`/api/projects/${p.fs.projectId}/chapters`, {
    chapter: 1,
  });
  expect(accepted.status).toBe(202);
  const runId = (await accepted.json()).id;
  expect((await p.call(own, { limitCredits: 1 })).status).toBe(200);
  await p.service.handle({
    kind: "chapter",
    projectId: p.fs.projectId,
    ownerId: p.fs.ownerId,
    runId,
  });
  expect(p.calls()).toBe(0);
  expect((await balance(db.pool, p.fs.ownerId, "sandbox")).reserved).toBe("0");
  expect((await p.call(own, { limitCredits: null })).status).toBe(200);
});
it("configured disposable domains and subdomains cannot consume an invitation, create an account or send preview mail via direct auth", async () => {
  const p = await setup(),
    db = p.service.db;
  const invitation = randomUUID(),
    digest = hash(invitation);
  await db.pool.query(
    "INSERT INTO web_invitations(token_hash,max_uses) VALUES($1,10)",
    [digest],
  );
  const before = (
    await db.pool.query(
      "SELECT uses FROM web_invitations WHERE token_hash=$1",
      [digest],
    )
  ).rows[0];
  const email = `${randomUUID()}@MAILINATOR.com`;
  expect(disposableEmail(email)).toBe(true);
  expect(disposableEmail("a@sub.mailinator.com.")).toBe(true);
  expect(disposableEmail("a@mailinator.com.example.org")).toBe(false);
  expect(
    (
      await p.call("/api/login", {
        email,
        invitationCode: invitation,
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await db.pool.query("SELECT id FROM users WHERE lower(email)=$1", [
        email.toLowerCase(),
      ])
    ).rowCount,
  ).toBe(0);
  expect(
    (
      await db.pool.query(
        "SELECT uses FROM web_invitations WHERE token_hash=$1",
        [digest],
      )
    ).rows[0],
  ).toEqual(before);
  await expect(
    p.services.auth.api.signInMagicLink({
      headers: new Headers({ origin }),
      body: {
        email,
        callbackURL: "/projects",
        metadata: { previewMailbox: "b".repeat(64) },
      },
    }),
  ).rejects.toThrow();
});

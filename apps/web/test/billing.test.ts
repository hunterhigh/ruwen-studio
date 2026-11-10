import { randomUUID } from "node:crypto";
import { createFauxRuntime } from "@ruwen/agents";
import { balance, MockProvider, PaymentService } from "@ruwen/billing";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeSettings } from "../../../config/settings.ts";
import { fixture } from "../../worker/test/helpers.ts";
import { handleApi } from "../src/server/api.ts";
import { createWebAuth } from "../src/server/auth.ts";
import type { WebServices } from "../src/server/services.ts";
import { loginFixture } from "./auth-fixture.ts";

const origin = "https://localhost:3000",
  csrf = "b".repeat(64),
  secret = "payment-test-signing-".repeat(3);
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const close of cleanup.splice(0)) await close();
});
async function setup(
  boundary?: (kind: string, role: string, runId: string) => Promise<void>,
  failBeforeUsage = false,
) {
  const runtime = createFauxRuntime();
  let calls = 0;
  const stream = runtime.models.streamSimple.bind(runtime.models);
  runtime.models.streamSimple = (...args) => {
    calls++;
    if (failBeforeUsage) throw new Error("test transport failed before usage");
    return stream(...args);
  };
  const p = await fixture({
    runtime: () => runtime,
    ...(boundary ? { onBoundary: boundary } : {}),
  });
  cleanup.push(() => p.service.stop());
  const environment = {
    baseURL: origin,
    secret: "billing-auth-test-".repeat(4),
    workspaceRoot: ".",
    preview: true,
  };
  const provider = new MockProvider(secret, 300);
  const services: WebServices = {
    worker: p.service,
    auth: createWebAuth(p.service.db, environment),
    environment,
    adminEmails: [],
    ipProofSecret: "test",
    payments: new PaymentService(p.service.db, { enabled: true, provider }),
  };
  const email = (
    await p.service.db.pool.query<{ email: string }>(
      "SELECT email FROM users WHERE id=$1",
      [p.fs.ownerId],
    )
  ).rows[0]?.email;
  if (!email) throw new Error("Missing user");
  const login = await loginFixture(services, email);
  const request = (
    path: string,
    body?: unknown,
    options: { anonymous?: boolean; csrf?: boolean; signature?: string } = {},
  ) =>
    new Request(origin + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        origin,
        cookie: `__Host-ruwen.csrf=${csrf}; ${options.anonymous ? "" : login.cookie}`,
        "x-csrf-token": options.csrf === false ? "" : csrf,
        ...(options.signature ? { "x-signature": options.signature } : {}),
      },
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  return { p, services, provider, request, email, calls: () => calls };
}
it("provider failure before usage is explicit unknown cost, not a zero-cost completion or automatic release", async () => {
  const f = await setup(undefined, true);
  const id = await f.p.service.enqueueChapter(f.p.fs, { chapter: 1 });
  expect(
    (
      await f.p.service.handle({
        kind: "chapter",
        projectId: f.p.fs.projectId,
        ownerId: f.p.fs.ownerId,
        runId: id,
      })
    )?.status,
  ).toBe("FAILED");
  const role = (
    await f.p.service.db.pool.query(
      "SELECT cost_usd,usage_unknown FROM role_runs WHERE run_id=$1",
      [id],
    )
  ).rows[0];
  expect(role).toMatchObject({ cost_usd: null, usage_unknown: true });
  const reservation = (
    await f.p.service.db.pool.query<{ status: string; remaining: string }>(
      "SELECT status,remaining::text FROM credit_reservations WHERE run_id=$1",
      [id],
    )
  ).rows[0];
  expect(reservation?.status).toBe("review");
  expect(BigInt(reservation?.remaining ?? "0")).toBeGreaterThan(0n);
});

it("a paid condition changed after enqueue blocks the actual model and releases the unused live reservation", async () => {
  const f = await setup();
  vi.stubEnv("MODEL_MODE", "real"); // Only selects the ledger bank; runtime remains an injected faux provider.
  const id = await f.p.service.enqueueChapter(f.p.fs, { chapter: 1 });
  await f.p.service.db.pool.query(
    "INSERT INTO subscriptions(user_id,provider,external_id,plan,status) VALUES($1,'fixture',$2,'test-paid','active')",
    [f.p.fs.ownerId, randomUUID()],
  );
  const run = await f.p.service.handle({
    kind: "chapter",
    projectId: f.p.fs.projectId,
    ownerId: f.p.fs.ownerId,
    runId: id,
  });
  expect(run?.status).toBe("FAILED");
  expect(f.calls()).toBe(0);
  expect(
    (await balance(f.p.service.db.pool, f.p.fs.ownerId, "live")).reserved,
  ).toBe("0");
  expect(
    (
      await f.p.service.db.pool.query(
        "SELECT id FROM pipeline_runs WHERE project_id=$1",
        [f.p.fs.projectId],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await f.p.service.db.pool.query(
        "SELECT id FROM credit_ledger WHERE user_id=$1 AND reason='role_usage'",
        [f.p.fs.ownerId],
      )
    ).rowCount,
  ).toBe(0);
});

it("freezing between roles preserves the first actual charge, blocks later model calls and releases known unused budget", async () => {
  let f: Awaited<ReturnType<typeof setup>>;
  f = await setup(async (kind, role) => {
    if (kind === "role_completed" && role === "xiaoshuo-zuozhe")
      for (let i = 0; i < runtimeSettings().riskReview.freezeScore; i++)
        await f.p.service.db.pool.query(
          "INSERT INTO security_events(user_id,kind,score) VALUES($1,'access_denied',1)",
          [f.p.fs.ownerId],
        );
  });
  const id = await f.p.service.enqueueChapter(f.p.fs, { chapter: 1 });
  const run = await f.p.service.handle({
    kind: "chapter",
    projectId: f.p.fs.projectId,
    ownerId: f.p.fs.ownerId,
    runId: id,
  });
  expect(run?.status).toBe("FAILED");
  expect(f.calls()).toBe(1);
  expect(
    (
      await f.p.service.db.pool.query(
        "SELECT id FROM credit_ledger WHERE user_id=$1 AND reason='role_usage'",
        [f.p.fs.ownerId],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (await balance(f.p.service.db.pool, f.p.fs.ownerId, "sandbox")).reserved,
  ).toBe("0");
});

for (const [code, status] of [
  ["INSUFFICIENT_CREDITS", 402],
  ["ACCOUNT_FROZEN", 423],
  ["BILLING_DISABLED", 403],
] as const) {
  it(`${code}: ownership/authentication precede refusal; no run, model call, reservation or new debit`, async () => {
    const f = await setup(),
      db = f.p.service.db,
      userId = f.p.fs.ownerId;
    if (code === "INSUFFICIENT_CREDITS")
      await db.pool.query(
        "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'sandbox',-$2::bigint,'fixture','deplete',$3)",
        [userId, runtimeSettings().billing.signupCredits, randomUUID()],
      );
    if (code === "ACCOUNT_FROZEN")
      for (let i = 0; i < runtimeSettings().riskReview.freezeScore; i++)
        await db.pool.query(
          "INSERT INTO security_events(user_id,kind,score) VALUES($1,'access_denied',1)",
          [userId],
        );
    if (code === "BILLING_DISABLED") {
      vi.stubEnv("MODEL_MODE", "real");
      await db.pool.query(
        "INSERT INTO subscriptions(user_id,provider,external_id,plan,status) VALUES($1,'fixture',$2,'test-paid','active')",
        [userId, randomUUID()],
      );
    }
    const initial = await balance(db.pool, userId, "sandbox");
    const entries = (
      await db.pool.query("SELECT id FROM credit_ledger WHERE user_id=$1", [
        userId,
      ])
    ).rowCount;
    const foreignOwner = randomUUID(),
      foreignProject = randomUUID();
    await db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
      foreignOwner,
      `${foreignOwner}@test.invalid`,
    ]);
    await db.pool.query(
      "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,'foreign','foreign')",
      [foreignProject, foreignOwner],
    );
    expect(
      (
        await handleApi(
          f.request(`/api/projects/${foreignProject}/chapters`, { chapter: 1 }),
          f.services,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await handleApi(
          f.request(
            `/api/projects/${f.p.fs.projectId}/chapters`,
            { chapter: 1 },
            { anonymous: true },
          ),
          f.services,
        )
      ).status,
    ).toBe(401);
    const response = await handleApi(
      f.request(`/api/projects/${f.p.fs.projectId}/chapters`, { chapter: 1 }),
      f.services,
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ ok: false, error: { code } });
    expect(
      (
        await db.pool.query(
          "SELECT id FROM pipeline_runs WHERE project_id=$1",
          [f.p.fs.projectId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          "SELECT id FROM credit_reservations WHERE user_id=$1",
          [userId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.pool.query("SELECT id FROM credit_ledger WHERE user_id=$1", [
          userId,
        ])
      ).rowCount,
    ).toBe(entries);
    expect(await balance(db.pool, userId, "sandbox")).toEqual(initial);
    expect(f.calls()).toBe(0);
  });
}

it("sandbox purchase requires CSRF; signed webhook replay credits once atomically and never credits the live bank", async () => {
  const f = await setup(),
    userId = f.p.fs.ownerId,
    db = f.p.service.db;
  const body = { planId: "preview", clientRequestId: randomUUID() };
  expect(
    (
      await handleApi(
        f.request("/api/billing/checkout", body, { csrf: false }),
        f.services,
      )
    ).status,
  ).toBe(403);
  const response = await handleApi(
    f.request("/api/billing/checkout", body),
    f.services,
  );
  expect(response.status).toBe(201);
  const checkout = await response.json();
  expect(
    (
      await (
        await handleApi(f.request("/api/billing/checkout", body), f.services)
      ).json()
    ).id,
  ).toBe(checkout.id);
  const sandbox = await balance(db.pool, userId, "sandbox"),
    live = await balance(db.pool, userId, "live");
  const event = f.provider.notification({
    id: checkout.id,
    email: "",
    priceMinor: runtimeSettings().billing.plans[0]?.priceMinor ?? 0,
    variantId: null,
  });
  const webhook = () =>
    new Request(`${origin}/api/billing/webhooks/mock`, {
      method: "POST",
      headers: { "x-signature": event.signature },
      body: event.raw,
    });
  expect(
    (
      await handleApi(
        new Request(`${origin}/api/billing/webhooks/mock`, {
          method: "POST",
          body: event.raw,
        }),
        f.services,
      )
    ).status,
  ).toBe(401);
  const result = await Promise.all([
    handleApi(webhook(), f.services),
    handleApi(webhook(), f.services),
  ]);
  expect(result.map((item) => item.status)).toEqual([200, 200]);
  expect(
    (
      await db.pool.query(
        "SELECT id FROM credit_ledger WHERE user_id=$1 AND reason='payment'",
        [userId],
      )
    ).rowCount,
  ).toBe(1);
  expect(BigInt((await balance(db.pool, userId, "sandbox")).balance)).toBe(
    BigInt(sandbox.balance) +
      BigInt(runtimeSettings().billing.plans[0]?.credits ?? 0),
  );
  expect(await balance(db.pool, userId, "live")).toEqual(live);
  const stale = f.provider.notification(
    {
      id: checkout.id,
      email: "",
      priceMinor: runtimeSettings().billing.plans[0]?.priceMinor ?? 0,
      variantId: null,
    },
    Date.now() - 301000,
  );
  expect(
    (
      await handleApi(
        new Request(`${origin}/api/billing/webhooks/mock`, {
          method: "POST",
          headers: { "x-signature": stale.signature },
          body: stale.raw,
        }),
        f.services,
      )
    ).status,
  ).toBe(401);
});

it("risk threshold freezes immediately; only audited admin CSRF-protected review unfreezes, and new events can freeze again", async () => {
  const f = await setup(),
    db = f.p.service.db,
    target = randomUUID();
  await db.pool.query("INSERT INTO users(id,email) VALUES($1,$2)", [
    target,
    `${target}@test.invalid`,
  ]);
  for (let n = 0; n < runtimeSettings().riskReview.freezeScore; n++)
    await db.pool.query(
      "INSERT INTO security_events(user_id,kind,score) VALUES($1,'access_denied',1)",
      [target],
    );
  const frozenAt = (
    await db.pool.query<{ frozen_at: Date }>(
      "SELECT frozen_at FROM billing_accounts WHERE user_id=$1",
      [target],
    )
  ).rows[0]?.frozen_at.toISOString();
  expect(frozenAt).toBeTruthy();
  const path = `/api/admin/accounts/${target}/unfreeze`,
    body = { confirmed: true, expectedFrozenAt: frozenAt };
  expect((await handleApi(f.request(path, body), f.services)).status).toBe(404);
  f.services.adminEmails = [f.email];
  expect(
    (await handleApi(f.request(path, body, { csrf: false }), f.services))
      .status,
  ).toBe(403);
  expect((await handleApi(f.request(path, body), f.services)).status).toBe(200);
  expect(
    (
      await db.pool.query(
        "SELECT frozen_at FROM billing_accounts WHERE user_id=$1",
        [target],
      )
    ).rows[0]?.frozen_at,
  ).toBeNull();
  expect(
    (
      await db.pool.query("SELECT id FROM security_events WHERE user_id=$1", [
        target,
      ])
    ).rowCount,
  ).toBe(runtimeSettings().riskReview.freezeScore);
  for (let n = 0; n < runtimeSettings().riskReview.freezeScore; n++)
    await db.pool.query(
      "INSERT INTO security_events(user_id,kind,score) VALUES($1,'access_denied',1)",
      [target],
    );
  const audit = await db.pool.query<{ id: string; action: string }>(
    "SELECT id,action FROM account_risk_audit WHERE user_id=$1 ORDER BY created_at",
    [target],
  );
  expect(audit.rows.map((row) => row.action)).toEqual([
    "freeze",
    "unfreeze",
    "freeze",
  ]);
  await expect(
    db.pool.query("DELETE FROM account_risk_audit WHERE id=$1", [
      audit.rows[0]?.id,
    ]),
  ).rejects.toThrow("append-only");
});

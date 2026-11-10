import { createHmac, randomUUID } from "node:crypto";
import type { Database } from "@ruwen/db";
import { expect, it, vi } from "vitest";
import { PaymentService } from "../src/payments.ts";
import { LemonSqueezyProvider, MockProvider } from "../src/providers.ts";

const secret = "test-signing-only-".repeat(3);
it("production refuses mock charging even when a sandbox flag is accidentally enabled", () => {
  vi.stubEnv("NODE_ENV", "production");
  try {
    expect(
      new PaymentService({} as Database, {
        enabled: true,
        provider: new MockProvider(secret, 300),
      }).enabled,
    ).toBe(false);
  } finally {
    vi.unstubAllEnvs();
  }
});
it("mock verifies exact signed bytes and rejects stale/future or altered notifications", () => {
  const provider = new MockProvider(secret, 300),
    time = Date.now();
  const event = provider.notification(
    { id: randomUUID(), email: "", priceMinor: 500, variantId: null },
    time,
  );
  expect(
    provider.verifyWebhook(event.raw, event.signature, time).amountMinor,
  ).toBe(500);
  expect(() =>
    provider.verifyWebhook(`${event.raw} `, event.signature, time),
  ).toThrow();
  expect(() =>
    provider.verifyWebhook(event.raw, event.signature, time + 301000),
  ).toThrow();
  expect(() =>
    provider.verifyWebhook(event.raw, event.signature, time - 301000),
  ).toThrow();
});
it("Lemon Squeezy sends test_mode only and accepts a signed fresh paid test order with the configured store/variant", async () => {
  let request: unknown;
  const fetcher: typeof fetch = async (url, options) => {
    expect(String(url)).toBe("https://api.lemonsqueezy.com/v1/checkouts");
    request = JSON.parse(String(options?.body));
    return Response.json({
      data: {
        attributes: {
          test_mode: true,
          url: "https://test-store.lemonsqueezy.com/checkout/buy/example",
        },
      },
    });
  };
  const provider = new LemonSqueezyProvider({
    apiKey: "test-only-credential",
    secret,
    storeId: "7",
    skewSeconds: 300,
    timeoutMs: 1000,
    fetch: fetcher,
  });
  const checkout = randomUUID(),
    now = Date.now();
  await provider.createCheckout({
    id: checkout,
    email: "test@example.invalid",
    priceMinor: 500,
    variantId: "9",
  });
  expect(request).toMatchObject({
    data: {
      attributes: {
        test_mode: true,
        custom_price: 500,
        checkout_data: { custom: { checkout_id: checkout } },
      },
    },
  });
  const payload = {
    meta: {
      event_name: "order_created",
      custom_data: { checkout_id: checkout },
    },
    data: {
      id: "42",
      type: "orders",
      attributes: {
        store_id: 7,
        test_mode: true,
        status: "paid",
        refunded: false,
        currency: "USD",
        subtotal: 500,
        discount_total: 0,
        first_order_item: { variant_id: 9, test_mode: true },
        updated_at: new Date(now).toISOString(),
      },
    },
  };
  const verify = () => {
    const raw = JSON.stringify(payload);
    return provider.verifyWebhook(
      raw,
      createHmac("sha256", secret).update(raw).digest("hex"),
      now,
    );
  };
  expect(verify()).toMatchObject({
    checkoutId: checkout,
    orderId: "42",
    amountMinor: 500,
    variantId: "9",
  });
  payload.data.attributes.test_mode = false;
  expect(verify).toThrow();
  payload.data.attributes.test_mode = true;
  payload.data.attributes.updated_at = new Date(now - 301000).toISOString();
  expect(verify).toThrow();
});

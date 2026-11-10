import { createHmac, timingSafeEqual } from "node:crypto";
import { BillingError } from "./ledger.ts";

export interface CheckoutInput {
  id: string;
  email: string;
  priceMinor: number;
  variantId: string | null;
}
export interface VerifiedPayment {
  eventId: string;
  checkoutId: string;
  orderId: string;
  amountMinor: number;
  currency: "USD";
  variantId: string | null;
  occurredAt: string;
}
export interface PaymentProvider {
  readonly name: "mock" | "lemonsqueezy";
  createCheckout(input: CheckoutInput): Promise<{ url: string | null }>;
  verifyWebhook(raw: string, signature: string, now?: number): VerifiedPayment;
}
const invalid = () =>
  new BillingError("UNAUTHENTICATED", 401, "支付通知验证失败。");
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function signedBody(raw: string, signature: string, secret: string) {
  if (
    !/^[a-f0-9]{64}$/i.test(signature) ||
    !timingSafeEqual(
      Buffer.from(signature, "hex"),
      createHmac("sha256", secret).update(raw).digest(),
    )
  )
    throw invalid();
  try {
    return record(JSON.parse(raw));
  } catch {
    throw invalid();
  }
}
function timestamp(value: unknown, skewSeconds: number, now: number) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    Math.abs(now - Date.parse(value)) > skewSeconds * 1000
  )
    throw invalid();
  return value;
}
function checkoutId(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
  )
    throw invalid();
  return value;
}
function amount(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw invalid();
  return Number(value);
}
export class MockProvider implements PaymentProvider {
  readonly name = "mock";
  private secret: string;
  private skewSeconds: number;
  constructor(secret: string, skewSeconds: number) {
    this.secret = secret;
    this.skewSeconds = skewSeconds;
    if (secret.length < 32) throw new Error("Mock signing secret too short");
  }
  async createCheckout(_input: CheckoutInput) {
    return { url: null };
  }
  notification(input: CheckoutInput, now = Date.now()) {
    const raw = JSON.stringify({
      id: `mock:${input.id}`,
      checkoutId: input.id,
      amountMinor: input.priceMinor,
      currency: "USD",
      testMode: true,
      occurredAt: new Date(now).toISOString(),
    });
    return {
      raw,
      signature: createHmac("sha256", this.secret).update(raw).digest("hex"),
    };
  }
  verifyWebhook(
    raw: string,
    signature: string,
    now = Date.now(),
  ): VerifiedPayment {
    const data = signedBody(raw, signature, this.secret),
      id = checkoutId(data.checkoutId);
    if (
      data.testMode !== true ||
      data.currency !== "USD" ||
      data.id !== `mock:${id}`
    )
      throw invalid();
    return {
      eventId: String(data.id),
      checkoutId: id,
      orderId: String(data.id),
      amountMinor: amount(data.amountMinor),
      currency: "USD",
      variantId: null,
      occurredAt: timestamp(data.occurredAt, this.skewSeconds, now),
    };
  }
}
export class LemonSqueezyProvider implements PaymentProvider {
  readonly name = "lemonsqueezy";
  private options: {
    apiKey: string;
    secret: string;
    storeId: string;
    skewSeconds: number;
    timeoutMs: number;
    fetch?: typeof fetch;
  };
  constructor(options: {
    apiKey: string;
    secret: string;
    storeId: string;
    skewSeconds: number;
    timeoutMs: number;
    fetch?: typeof fetch;
  }) {
    this.options = options;
    if (
      !options.apiKey ||
      options.secret.length < 32 ||
      !/^\d+$/.test(options.storeId)
    )
      throw new Error("Invalid sandbox payment configuration");
  }
  async createCheckout(input: CheckoutInput) {
    if (!input.variantId || !/^\d+$/.test(input.variantId))
      throw new BillingError("BILLING_DISABLED", 403, "测试商品尚未配置。");
    const response = await (this.options.fetch ?? fetch)(
      "https://api.lemonsqueezy.com/v1/checkouts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          Accept: "application/vnd.api+json",
          "Content-Type": "application/vnd.api+json",
        },
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: "error",
        body: JSON.stringify({
          data: {
            type: "checkouts",
            attributes: {
              test_mode: true,
              custom_price: input.priceMinor,
              checkout_data: {
                email: input.email,
                custom: { checkout_id: input.id },
              },
              checkout_options: { discount: false },
              product_options: { enabled_variants: [Number(input.variantId)] },
            },
            relationships: {
              store: { data: { type: "stores", id: this.options.storeId } },
              variant: { data: { type: "variants", id: input.variantId } },
            },
          },
        }),
      },
    );
    if (!response.ok)
      throw new BillingError(
        "PROVIDER_UNAVAILABLE",
        503,
        "测试支付服务暂不可用。",
      );
    const attributes = record(
      record(record(await response.json()).data).attributes,
    );
    if (attributes.test_mode !== true || typeof attributes.url !== "string")
      throw invalid();
    const url = new URL(attributes.url);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".lemonsqueezy.com") ||
      url.username ||
      url.password ||
      url.port
    )
      throw invalid();
    return { url: url.href };
  }
  verifyWebhook(
    raw: string,
    signature: string,
    now = Date.now(),
  ): VerifiedPayment {
    const payload = signedBody(raw, signature, this.options.secret),
      meta = record(payload.meta),
      data = record(payload.data),
      attributes = record(data.attributes);
    const item = record(attributes.first_order_item);
    if (
      meta.event_name !== "order_created" ||
      data.type !== "orders" ||
      typeof data.id !== "string" ||
      !/^\d+$/.test(data.id) ||
      String(attributes.store_id) !== this.options.storeId ||
      attributes.test_mode !== true ||
      item.test_mode !== true ||
      attributes.status !== "paid" ||
      attributes.refunded !== false ||
      attributes.currency !== "USD" ||
      attributes.discount_total !== 0 ||
      !/^\d+$/.test(String(item.variant_id))
    )
      throw invalid();
    return {
      eventId: `order_created:${data.id}`,
      orderId: data.id,
      checkoutId: checkoutId(record(meta.custom_data).checkout_id),
      amountMinor: amount(attributes.subtotal),
      currency: "USD",
      variantId: String(item.variant_id),
      occurredAt: timestamp(
        attributes.updated_at,
        this.options.skewSeconds,
        now,
      ),
    };
  }
}

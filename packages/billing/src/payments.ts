import { createHmac, randomUUID } from "node:crypto";
import type { Database } from "@ruwen/db";
import { runtimeSettings } from "../../../config/settings.ts";
import { BillingError, lockAccount } from "./ledger.ts";
import {
  LemonSqueezyProvider,
  MockProvider,
  type PaymentProvider,
} from "./providers.ts";

interface CheckoutRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  provider: string;
  plan_id: string;
  credits: string;
  price_minor: number;
  variant_id: string | null;
  external_url: string | null;
  prepared_at: Date | null;
  status: string;
  order_id: string | null;
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export class PaymentService {
  readonly db: Database;
  readonly options: {
    enabled: boolean;
    provider?: PaymentProvider;
    variantIds?: Readonly<Record<string, string>>;
  };
  constructor(
    db: Database,
    options: {
      enabled: boolean;
      provider?: PaymentProvider;
      variantIds?: Readonly<Record<string, string>>;
    },
  ) {
    this.db = db;
    this.options = options;
  }
  get enabled() {
    return (
      this.options.enabled &&
      !!this.options.provider &&
      !(
        this.options.provider.name === "mock" &&
        process.env.NODE_ENV === "production"
      )
    );
  }
  private provider() {
    if (!this.enabled || !this.options.provider)
      throw new BillingError(
        "BILLING_DISABLED",
        403,
        "测试支付尚未开放，真实收费保持关闭。",
      );
    return this.options.provider;
  }
  async create(userId: string, planId: string, requestId: string) {
    const provider = this.provider(),
      plan = runtimeSettings().billing.plans.find((item) => item.id === planId);
    if (!plan || !uuid.test(requestId))
      throw new BillingError(
        "INVALID_ARGUMENT",
        400,
        "请选择有效的测试点数包。",
      );
    const prepared = await this.db.transaction(async (tx) => {
      if ((await lockAccount(tx, userId)).frozen_at)
        throw new BillingError(
          "ACCOUNT_FROZEN",
          423,
          "账户运行已冻结，等待人工复核。",
        );
      const previous = (
        await tx.query<CheckoutRow>(
          "SELECT * FROM billing_checkouts WHERE user_id=$1 AND request_id=$2",
          [userId, requestId],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.plan_id !== planId ||
          previous.provider !== provider.name ||
          !previous.prepared_at
        )
          throw new BillingError(
            "PRECONDITION_FAILED",
            409,
            "结账请求已存在，请刷新账户核对结果。",
          );
        return { row: previous, existing: true, email: "" };
      }
      const email = (
        await tx.query<{ email: string }>(
          "SELECT email FROM users WHERE id=$1",
          [userId],
        )
      ).rows[0]?.email;
      if (!email) throw new BillingError("NOT_FOUND", 404, "账户不存在。");
      const row = (
        await tx.query<CheckoutRow>(
          "INSERT INTO billing_checkouts(id,user_id,request_id,provider,plan_id,credits,price_minor,currency,variant_id) VALUES($1,$2,$3,$4,$5,$6,$7,'USD',$8) RETURNING *",
          [
            randomUUID(),
            userId,
            requestId,
            provider.name,
            planId,
            plan.credits,
            plan.priceMinor,
            this.options.variantIds?.[planId] ?? null,
          ],
        )
      ).rows[0];
      if (!row) throw new Error("Missing checkout");
      return { row, email, existing: false };
    });
    if (!prepared.existing) {
      const result = await provider.createCheckout({
        id: prepared.row.id,
        email: prepared.email,
        priceMinor: prepared.row.price_minor,
        variantId: prepared.row.variant_id,
      });
      await this.db.pool.query(
        "UPDATE billing_checkouts SET external_url=$2,prepared_at=now() WHERE id=$1",
        [prepared.row.id, result.url],
      );
      prepared.row.external_url = result.url;
    }
    return {
      id: prepared.row.id,
      provider: provider.name,
      url: prepared.row.external_url,
      sandbox: true,
    };
  }
  async processWebhook(raw: string, signature: string, providerName: string) {
    const provider = this.provider();
    if (provider.name !== providerName)
      throw new BillingError("NOT_FOUND", 404, "支付入口不存在。");
    if (
      Buffer.byteLength(raw) > runtimeSettings().billing.payment.maxWebhookBytes
    )
      throw new BillingError("INVALID_ARGUMENT", 413, "支付通知过大。");
    const event = provider.verifyWebhook(raw, signature);
    const owner = (
      await this.db.pool.query<{ user_id: string }>(
        "SELECT user_id FROM billing_checkouts WHERE id=$1 AND provider=$2",
        [event.checkoutId, provider.name],
      )
    ).rows[0]?.user_id;
    if (!owner) throw new BillingError("NOT_FOUND", 404, "结账记录不存在。");
    return this.db.transaction(async (tx) => {
      await lockAccount(tx, owner);
      const row = (
        await tx.query<CheckoutRow>(
          "SELECT * FROM billing_checkouts WHERE id=$1 AND user_id=$2 FOR UPDATE",
          [event.checkoutId, owner],
        )
      ).rows[0];
      if (
        !row ||
        row.price_minor !== event.amountMinor ||
        row.variant_id !== event.variantId
      )
        throw new BillingError(
          "PRECONDITION_FAILED",
          409,
          "支付金额或商品与结账记录不一致。",
        );
      const duplicate = (
        await tx.query<{ payload: { checkoutId: string; orderId: string } }>(
          "SELECT payload FROM payment_events WHERE provider=$1 AND external_event_id=$2",
          [provider.name, event.eventId],
        )
      ).rows[0];
      if (duplicate) {
        if (
          duplicate.payload.checkoutId !== row.id ||
          duplicate.payload.orderId !== event.orderId
        )
          throw new BillingError(
            "PRECONDITION_FAILED",
            409,
            "支付通知关联冲突。",
          );
        return { accepted: true, duplicate: true };
      }
      if (row.status !== "pending")
        throw new BillingError(
          "PRECONDITION_FAILED",
          409,
          "结账已有处理结果。",
        );
      await tx.query(
        "INSERT INTO payment_events(provider,external_event_id,payload,processed_at) VALUES($1,$2,$3,now())",
        [provider.name, event.eventId, JSON.stringify(event)],
      );
      await tx.query(
        "INSERT INTO credit_ledger(user_id,bank,delta_credits,reason,ref_type,ref_id) VALUES($1,'sandbox',$2,'payment',$3,$4)",
        [owner, row.credits, provider.name, event.orderId],
      );
      await tx.query(
        "UPDATE billing_checkouts SET status='paid',order_id=$2 WHERE id=$1",
        [row.id, event.orderId],
      );
      return { accepted: true, duplicate: false };
    });
  }
  async completeMock(userId: string, id: string) {
    const provider = this.provider();
    if (!(provider instanceof MockProvider))
      throw new BillingError("BILLING_DISABLED", 403, "此入口仅用于模拟支付。");
    const row = (
      await this.db.pool.query<CheckoutRow>(
        "SELECT * FROM billing_checkouts WHERE id=$1 AND user_id=$2 AND provider='mock'",
        [id, userId],
      )
    ).rows[0];
    if (!row || !row.prepared_at)
      throw new BillingError("NOT_FOUND", 404, "结账记录不存在。");
    const notification = provider.notification({
      id: row.id,
      email: "",
      priceMinor: row.price_minor,
      variantId: null,
    });
    return this.processWebhook(
      notification.raw,
      notification.signature,
      "mock",
    );
  }
}
export function createPayments(
  db: Database,
  secret: string,
  preview: boolean,
  env: NodeJS.ProcessEnv = process.env,
) {
  const config = runtimeSettings().billing.payment;
  const enabled =
    env.BILLING_SANDBOX_ENABLED === "1" ||
    (env.BILLING_SANDBOX_ENABLED === undefined && config.sandboxEnabled);
  if (!enabled) return new PaymentService(db, { enabled: false });
  const name = env.PAYMENT_PROVIDER ?? config.provider;
  if (name === "mock" && preview && env.NODE_ENV !== "production")
    return new PaymentService(db, {
      enabled: true,
      provider: new MockProvider(
        createHmac("sha256", secret)
          .update("ruwen-mock-payments-v1")
          .digest("hex"),
        config.webhookSkewSeconds,
      ),
    });
  if (
    name === "lemonsqueezy" &&
    env.LEMON_SQUEEZY_API_KEY &&
    env.LEMON_SQUEEZY_WEBHOOK_SECRET &&
    env.LEMON_SQUEEZY_STORE_ID
  )
    return new PaymentService(db, {
      enabled: true,
      provider: new LemonSqueezyProvider({
        apiKey: env.LEMON_SQUEEZY_API_KEY,
        secret: env.LEMON_SQUEEZY_WEBHOOK_SECRET,
        storeId: env.LEMON_SQUEEZY_STORE_ID,
        skewSeconds: config.webhookSkewSeconds,
        timeoutMs: config.requestTimeoutMs,
      }),
      variantIds: Object.fromEntries(
        runtimeSettings().billing.plans.map((plan) => [
          plan.id,
          env[`LEMON_SQUEEZY_VARIANT_${plan.id.toUpperCase()}`] ?? "",
        ]),
      ),
    });
  return new PaymentService(db, { enabled: false });
}

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const time = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();
const id = () => uuid("id").primaryKey().defaultRandom();
const bytes = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  createdAt: time("created_at"),
  locale: text("locale").notNull().default("zh-CN"),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  updatedAt: time("updated_at"),
});
export const sessions = pgTable("sessions", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: time("created_at"),
});
export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    accountId: text("account_id").notNull(),
  },
  (t) => [uniqueIndex("accounts_provider_account").on(t.provider, t.accountId)],
);
export const projects = pgTable("projects", {
  id: id(),
  ownerId: uuid("owner_id")
    .notNull()
    .references(() => users.id),
  projectKey: text("project_key").notNull(),
  title: text("title").notNull(),
  createdAt: time("created_at"),
  upstreamVersion: text("upstream_version").notNull().default("5.0.0"),
});
export const projectFiles = pgTable(
  "project_files",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    content: bytes("content").notNull(),
    sha256: text("sha256").generatedAlwaysAs(
      sql`encode(sha256(content), 'hex')`,
    ),
    size: integer("size").generatedAlwaysAs(sql`octet_length(content)`),
    updatedAt: time("updated_at"),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.path] })],
);
export const projectFileHistory = pgTable("project_file_history", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  sha256: text("sha256").notNull(),
  content: bytes("content").notNull(),
  changedAt: time("changed_at"),
  causeEventId: text("cause_event_id"),
});
export const approvalEvents = pgTable(
  "approval_events",
  {
    id: text("id").notNull(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    eventPath: text("event_path").notNull(),
    action: text("action").notNull(),
    targetPath: text("target_path").notNull(),
    targetSha256: text("target_sha256").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: time("created_at"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    uniqueIndex("approval_event_path").on(t.projectId, t.eventPath),
  ],
);
export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  chapter: text("chapter"),
  status: text("status").notNull(),
  request: jsonb("request").notNull(),
  cancelRequested: boolean("cancel_requested").notNull().default(false),
  createdAt: time("created_at"),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});
export const pipelineSteps = pgTable(
  "pipeline_steps",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    status: text("status").notNull(),
    inputRef: jsonb("input_ref"),
    outputRef: jsonb("output_ref"),
    error: text("error"),
    startedAt: time("started_at"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.runId, t.step] })],
);
export const prompts = pgTable("prompts", {
  sha256: text("sha256").primaryKey(),
  content: text("content").notNull(),
});
export const roleRuns = pgTable(
  "role_runs",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: "cascade" }),
    roleId: text("role_id").notNull(),
    status: text("status").notNull(),
    inputSha256: text("input_sha256").notNull(),
    model: text("model"),
    promptSha256: text("prompt_sha256").references(() => prompts.sha256),
    result: jsonb("result"),
    transcript: jsonb("transcript"),
    usage: jsonb("usage"),
    costUsd: numeric("cost_usd", { precision: 20, scale: 10 }),
    usageUnknown: boolean("usage_unknown").notNull().default(false),
    cacheRead: bigint("cache_read_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cacheWrite: bigint("cache_write_tokens", { mode: "number" })
      .notNull()
      .default(0),
    startedAt: time("started_at"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("role_run_once").on(t.runId, t.roleId)],
);
export const ideationMessages = pgTable("ideation_messages", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").notNull(),
  role: text("role").notNull(),
  content: jsonb("content").notNull(),
  createdAt: time("created_at"),
});
export const previews = pgTable("previews", {
  id: id(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: time("created_at"),
});
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    bank: text("bank").notNull().default("live"),
    deltaCredits: bigint("delta_credits", { mode: "bigint" }).notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type").notNull(),
    refId: text("ref_id").notNull(),
    createdAt: time("created_at"),
  },
  (t) => [
    uniqueIndex("credit_ledger_ref").on(
      t.userId,
      t.bank,
      t.reason,
      t.refType,
      t.refId,
    ),
  ],
);
export const creditReservations = pgTable(
  "credit_reservations",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    runId: uuid("run_id")
      .notNull()
      .references(() => pipelineRuns.id),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
    bank: text("bank").notNull().default("live"),
    remaining: bigint("remaining", { mode: "bigint" }).notNull().default(0n),
    costMarkup: numeric("cost_markup").notNull().default("1"),
    creditsPerUsd: numeric("credits_per_usd").notNull().default("1"),
    status: text("status").notNull(),
    createdAt: time("created_at"),
  },
  (t) => [uniqueIndex("credit_reservation_run").on(t.runId)],
);
export const billingPolicy = pgTable("billing_policy", {
  id: boolean("id").primaryKey().default(true),
  signupCredits: bigint("signup_credits", { mode: "bigint" }).notNull(),
  riskThreshold: integer("risk_threshold").notNull(),
});
export const billingAccounts = pgTable("billing_accounts", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenScore: bigint("frozen_score", { mode: "bigint" }),
  reviewedScore: bigint("reviewed_score", { mode: "bigint" })
    .notNull()
    .default(0n),
});
export const accountRiskAudit = pgTable("account_risk_audit", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  score: bigint("score", { mode: "bigint" }).notNull(),
  createdAt: time("created_at"),
});
export const billingCheckouts = pgTable(
  "billing_checkouts",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    requestId: uuid("request_id").notNull(),
    provider: text("provider").notNull(),
    planId: text("plan_id").notNull(),
    credits: bigint("credits", { mode: "bigint" }).notNull(),
    priceMinor: integer("price_minor").notNull(),
    currency: text("currency").notNull(),
    variantId: text("variant_id"),
    externalUrl: text("external_url"),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    status: text("status").notNull().default("pending"),
    orderId: text("order_id"),
    createdAt: time("created_at"),
  },
  (t) => [
    uniqueIndex("billing_checkouts_user_id_request_id_key").on(
      t.userId,
      t.requestId,
    ),
    uniqueIndex("billing_checkouts_provider_order_id_key").on(
      t.provider,
      t.orderId,
    ),
  ],
);
export const subscriptions = pgTable("subscriptions", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
});
export const paymentEvents = pgTable(
  "payment_events",
  {
    provider: text("provider").notNull(),
    externalEventId: text("external_event_id").notNull(),
    payload: jsonb("payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.provider, t.externalEventId] })],
);
// Actual charging is P6; P4 records each completed role cost once for settlement.
export const roleCostEvents = pgTable("role_cost_events", {
  roleRunId: uuid("role_run_id")
    .primaryKey()
    .references(() => roleRuns.id),
  costUsd: numeric("cost_usd", { precision: 20, scale: 10 }).notNull(),
  createdAt: time("created_at"),
});
// Web authentication keeps the P4 legacy session/account tables untouched.
export const authSessions = pgTable("auth_sessions", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: time("created_at"),
    updatedAt: time("updated_at"),
  },
  (table) => [
    uniqueIndex("auth_accounts_provider_id_account_id_key").on(
      table.providerId,
      table.accountId,
    ),
  ],
);
export const authVerifications = pgTable("auth_verifications", {
  id: id(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: time("created_at"),
  updatedAt: time("updated_at"),
});
export const webInvitations = pgTable("web_invitations", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  maxUses: integer("max_uses").notNull(),
  uses: integer("uses").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: time("created_at"),
});
export const webInviteGrants = pgTable("web_invite_grants", {
  email: text("email").primaryKey(),
  invitationId: uuid("invitation_id")
    .notNull()
    .references(() => webInvitations.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: time("created_at"),
});
export const webRunEvents = pgTable("web_run_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  runId: uuid("run_id")
    .notNull()
    .references(() => pipelineRuns.id, { onDelete: "cascade" }),
  roleId: text("role_id").notNull(),
  delta: text("delta").notNull(),
  eventType: text("event_type").notNull().default("delta"),
  resetReason: text("reset_reason"),
  createdAt: time("created_at"),
});
export const webRateLimits = pgTable("web_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  attempts: bigint("attempts", { mode: "number" }).notNull().default(1),
});
export const securityEvents = pgTable(
  "security_events",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    runId: uuid("run_id").references(() => pipelineRuns.id, {
      onDelete: "cascade",
    }),
    roleId: text("role_id"),
    kind: text("kind").notNull(),
    score: integer("score").notNull(),
    createdAt: time("created_at"),
  },
  (t) => [uniqueIndex("security_event_once").on(t.runId, t.roleId, t.kind)],
);
export const webAdminAudit = pgTable("web_admin_audit", {
  id: id(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  createdAt: time("created_at"),
});

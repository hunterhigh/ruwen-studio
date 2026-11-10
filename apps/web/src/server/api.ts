import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { FAUX_SCENARIOS, ROLE_IDS, type RoleResult } from "@ruwen/agents";
import { BillingError, createPayments, unfreezeAccount } from "@ruwen/billing";
import {
  checks,
  exportProjectZip,
  importProjectZip,
  initProject,
  LocalDirFS,
  registry,
  state,
} from "@ruwen/core";
import { type ChapterRun, loadRun, runPath } from "@ruwen/pipeline";
import { releasePolicy, runtimeSettings } from "../../../../config/settings.ts";
import {
  type AdminAction,
  adminAllowed,
  adminRiskReview,
  auditAdmin,
} from "./admin-review.ts";
import { newMailbox, previewMail, redeemInvitation } from "./auth.ts";
import { billingAccount } from "./billing-account.ts";
import { type Resource, requireOwnership } from "./ownership.ts";
import {
  CSRF_COOKIE,
  clientIp,
  cookie,
  csrfToken,
  HttpError,
  hash,
  loginLimit,
  MAILBOX_COOKIE,
  readCookie,
  requireCsrf,
} from "./security.ts";
import type { WebServices } from "./services.ts";

export interface RouteDefinition {
  method: string;
  pattern: string;
  resource?: "projectId" | "runId" | "checkoutId" | "accountId";
  authentication?: "signature";
  foreignCase?: string;
}
/** A resource route cannot be added without a 404 fixture; the route coverage test enforces this registry. */
export const API_ROUTES: readonly RouteDefinition[] = [
  { method: "GET", pattern: "/api/health" },
  { method: "GET", pattern: "/api/csrf" },
  { method: "POST", pattern: "/api/login" },
  { method: "GET", pattern: "/api/preview/mail" },
  { method: "GET", pattern: "/api/session" },
  { method: "GET", pattern: "/api/settings" },
  { method: "GET", pattern: "/api/projects" },
  { method: "POST", pattern: "/api/projects" },
  { method: "POST", pattern: "/api/projects/import" },
  {
    method: "GET",
    pattern: "/api/projects/:projectId",
    resource: "projectId",
    foreignCase: "foreign project details",
  },
  {
    method: "GET",
    pattern: "/api/projects/:projectId/readiness",
    resource: "projectId",
    foreignCase: "foreign readiness",
  },
  {
    method: "GET",
    pattern: "/api/projects/:projectId/files",
    resource: "projectId",
    foreignCase: "foreign file read",
  },
  {
    method: "GET",
    pattern: "/api/projects/:projectId/export",
    resource: "projectId",
    foreignCase: "foreign export",
  },
  {
    method: "GET",
    pattern: "/api/projects/:projectId/runs",
    resource: "projectId",
    foreignCase: "foreign run listing",
  },
  {
    method: "POST",
    pattern: "/api/projects/:projectId/chapters",
    resource: "projectId",
    foreignCase: "foreign chapter enqueue",
  },
  {
    method: "GET",
    pattern: "/api/runs/:runId",
    resource: "runId",
    foreignCase: "foreign run details",
  },
  {
    method: "GET",
    pattern: "/api/runs/:runId/events",
    resource: "runId",
    foreignCase: "foreign SSE subscription",
  },
  {
    method: "POST",
    pattern: "/api/runs/:runId/approve-candidate",
    resource: "runId",
    foreignCase: "foreign candidate approval",
  },
  {
    method: "POST",
    pattern: "/api/runs/:runId/approve-memory",
    resource: "runId",
    foreignCase: "foreign memory approval",
  },
  {
    method: "POST",
    pattern: "/api/runs/:runId/return",
    resource: "runId",
    foreignCase: "foreign candidate return",
  },
  {
    method: "POST",
    pattern: "/api/runs/:runId/cancel",
    resource: "runId",
    foreignCase: "foreign cancellation",
  },
  { method: "GET", pattern: "/api/account" },
  { method: "POST", pattern: "/api/billing/checkout" },
  {
    method: "POST",
    pattern: "/api/billing/checkouts/:checkoutId/complete",
    resource: "checkoutId",
    foreignCase: "foreign checkout completion",
  },
  {
    method: "POST",
    pattern: "/api/billing/webhooks/mock",
    authentication: "signature",
  },
  {
    method: "POST",
    pattern: "/api/billing/webhooks/lemonsqueezy",
    authentication: "signature",
  },
  { method: "GET", pattern: "/api/admin" },
  { method: "POST", pattern: "/api/admin/invitations" },
  {
    method: "POST",
    pattern: "/api/admin/accounts/:accountId/unfreeze",
    resource: "accountId",
    foreignCase: "foreign account risk review",
  },
];
export function json(value: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}
function match(request: Request) {
  const pathname = new URL(request.url).pathname;
  for (const route of API_ROUTES) {
    if (request.method !== route.method) continue;
    const keys: string[] = [];
    const pattern = route.pattern.replace(
      /:([a-zA-Z]+)/g,
      (_all, key: string) => {
        keys.push(key);
        return "([^/]+)";
      },
    );
    const found = new RegExp(`^${pattern}$`).exec(pathname);
    if (found)
      return {
        route,
        params: Object.fromEntries(
          keys.map((key, i) => [key, decodeURIComponent(found[i + 1] ?? "")]),
        ),
      };
  }
  throw new HttpError(404, "接口不存在。");
}
async function limitedBody(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, "文件或请求正文过大。");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const value = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    value.set(chunk, offset);
    offset += chunk.length;
  }
  return value;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await limitedBody(request, 65536),
      ),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("object");
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "请求正文必须是有效的JSON对象。");
  }
}
const string = (value: unknown, limit = 100) => {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    Array.from(value).length > limit
  )
    throw new HttpError(400, "请填写有效内容。");
  return value.trim();
};
export async function authenticated(request: Request, services: WebServices) {
  const session = await services.auth.api.getSession({
    headers: request.headers,
  });
  if (!session) {
    if (new URL(request.url).pathname.startsWith("/api/admin"))
      await auditAdmin(
        services.worker.db.pool,
        null,
        new URL(request.url).pathname.endsWith("/invitations")
          ? "invitation_create"
          : new URL(request.url).pathname.endsWith("/unfreeze")
            ? "account_unfreeze"
            : "dashboard_data",
        false,
      );
    throw new HttpError(401, "请先登录。");
  }
  return session.user;
}
const isAdmin = (services: WebServices, email: string) =>
  adminAllowed(services.adminEmails, email);
export async function runDetail(
  services: WebServices,
  userId: string,
  id: string,
) {
  const owned = await requireOwnership(services.worker.db, userId, {
    runId: id,
  });
  const row = await services.worker.db.pool.query<{
    status: string;
    chapter: string;
    kind: string;
    created_at: string;
    request: Record<string, unknown>;
  }>(
    "SELECT status,chapter,kind,created_at,request FROM pipeline_runs WHERE id=$1 AND project_id=$2",
    [id, owned.project.id],
  );
  const stored = row.rows[0];
  if (!stored) throw new HttpError(404, "运行不存在。");
  const run = (await owned.fs.exists(runPath(id)))
    ? await loadRun(owned.fs, id)
    : ({
        id,
        chapter: stored.chapter,
        status: stored.status,
        paths: {},
        roles: {},
        costTotal: 0,
      } as unknown as ChapterRun);
  const reports: Partial<
    Record<string, Omit<RoleResult, "systemPrompt" | "transcript">>
  > = {};
  for (const role of ROLE_IDS) {
    const ref = run.roles[role];
    if (ref?.path && (await owned.fs.exists(ref.path))) {
      const result = JSON.parse(
        await owned.fs.readText(ref.path),
      ) as RoleResult;
      reports[role] = {
        output: result.output,
        usage: result.usage,
        costTotal: result.costTotal,
        promptSha256: result.promptSha256,
        model: result.model,
        durationMs: result.durationMs,
        readResources: result.readResources,
        ...(result.runtimeMode ? { runtimeMode: result.runtimeMode } : {}),
      };
    }
  }
  const artifact = async (p: string | undefined) =>
    p && (await owned.fs.exists(p)) ? owned.fs.readText(p) : "";
  const roleRows = await services.worker.db.pool.query(
    "SELECT role_id,status,model,usage,cost_usd,usage_unknown,started_at,finished_at FROM role_runs WHERE run_id=$1 ORDER BY started_at",
    [id],
  );
  const memoryPreview = await artifact(run.paths.memory_preview);
  const memoryFiles: { path: string; before: string; after: string }[] = [];
  if (memoryPreview) {
    const preview = JSON.parse(memoryPreview) as {
      patches?: {
        path: string;
        base_sha256: string | null;
        new_content: string;
      }[];
    };
    for (const patch of preview.patches ?? []) {
      let before = await artifact(patch.path);
      if (
        patch.base_sha256 &&
        (await owned.fs.sha256(patch.path)) !== patch.base_sha256
      ) {
        const previous = await services.worker.db.pool.query<{
          content: Buffer;
        }>(
          "SELECT content FROM project_file_history WHERE project_id=$1 AND path=$2 AND sha256=$3 ORDER BY id DESC LIMIT 1",
          [owned.project.id, patch.path, patch.base_sha256],
        );
        before =
          previous.rows[0]?.content.toString("utf8") ??
          "原版本不可用，请核对历史记录。";
      }
      memoryFiles.push({
        path: patch.path,
        before,
        after: patch.new_content,
      });
    }
  }
  return {
    project: owned.project,
    run,
    reports,
    roles: roleRows.rows,
    prose: await artifact(run.paths.candidate ?? run.paths.author),
    original: await artifact(run.paths.original),
    memoryPreview,
    memoryFiles,
    factChanges: await artifact(
      `${runPath(id).replace("/run.json", "")}/fact-changes.json`,
    ),
    literaryChanges: await artifact(
      `${runPath(id).replace("/run.json", "")}/literary-changes.json`,
    ),
  };
}
async function events(
  request: Request,
  services: WebServices,
  userId: string,
  runId: string,
) {
  const owned = await requireOwnership(services.worker.db, userId, { runId });
  const settings = runtimeSettings().stream;
  let cursor = Number(
    request.headers.get("last-event-id") ??
      new URL(request.url).searchParams.get("after") ??
      0,
  );
  if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder(),
        started = Date.now();
      let last = "",
        heartbeat = 0;
      const send = (event: string, data: unknown, id?: number) =>
        controller.enqueue(
          encoder.encode(
            `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
          ),
        );
      void (async () => {
        try {
          while (
            !cancelled &&
            !request.signal.aborted &&
            Date.now() - started < settings.maxConnectionMs
          ) {
            await authenticated(request, services);
            await requireOwnership(services.worker.db, userId, { runId });
            const rows = await services.worker.db.pool.query<{
              id: string;
              role_id: string;
              delta: string;
              event_type: "delta" | "reset";
              reset_reason: string | null;
            }>(
              // Replay only approved onDelta text and fixed reset metadata from the worker sink.
              "SELECT id,role_id,delta,event_type,reset_reason FROM web_run_events WHERE project_id=$1 AND run_id=$2 AND id>$3 ORDER BY id LIMIT 256",
              [owned.project.id, runId, cursor],
            );
            for (const row of rows.rows) {
              cursor = Number(row.id);
              if (row.event_type === "reset")
                send(
                  "reset",
                  { role: row.role_id, reason: row.reset_reason },
                  cursor,
                );
              else
                send("delta", { role: row.role_id, text: row.delta }, cursor);
            }
            const state = await services.worker.db.pool.query(
              "SELECT status FROM pipeline_runs WHERE id=$1 AND project_id=$2",
              [runId, owned.project.id],
            );
            const roles = await services.worker.db.pool.query(
              "SELECT role_id,status,model,cost_usd,usage_unknown,started_at,finished_at FROM role_runs WHERE run_id=$1 ORDER BY started_at",
              [runId],
            );
            const snapshot = JSON.stringify({
              status: state.rows[0]?.status,
              roles: roles.rows,
            });
            if (snapshot !== last) {
              last = snapshot;
              send("status", JSON.parse(snapshot));
            }
            if (Date.now() - heartbeat >= settings.heartbeatMs) {
              heartbeat = Date.now();
              send("heartbeat", { at: heartbeat });
            }
            await new Promise((resolve) =>
              setTimeout(resolve, settings.pollIntervalMs),
            );
          }
          if (!cancelled) controller.close();
        } catch {
          if (!cancelled) {
            try {
              send("closed", { reason: "连接已结束，请刷新查看已保存结果。" });
              controller.close();
            } catch {
              /* already closed */
            }
          }
        }
      })();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
export async function handleApi(
  request: Request,
  services: WebServices,
): Promise<Response> {
  let actorId: string | undefined;
  let resourceRequest = false;
  try {
    const { route, params } = match(request),
      db = services.worker.db,
      url = new URL(request.url);
    const payments = () =>
      services.payments ??
      createPayments(
        db,
        services.environment.secret,
        services.environment.preview,
      );
    if (route.authentication === "signature") {
      const signature = request.headers.get("x-signature") ?? "";
      if (!/^[a-f0-9]{64}$/i.test(signature))
        throw new BillingError("UNAUTHENTICATED", 401, "支付通知验证失败。");
      const raw = new TextDecoder("utf-8", { fatal: true }).decode(
        await limitedBody(
          request,
          runtimeSettings().billing.payment.maxWebhookBytes,
        ),
      );
      return json(
        await payments().processWebhook(
          raw,
          signature,
          route.pattern.split("/").at(-1) ?? "",
        ),
      );
    }
    if (route.pattern === "/api/health")
      return json({
        ok: true,
        mode: process.env.MODEL_MODE ?? "faux",
        p3GatePassed: releasePolicy().p3GatePassed,
      });
    if (route.pattern === "/api/csrf") {
      const token = csrfToken(request);
      return json({ token }, 200, {
        "Set-Cookie": cookie(
          CSRF_COOKIE,
          token,
          runtimeSettings().security.csrfHours * 3600,
        ),
      });
    }
    if (route.pattern === "/api/preview/mail")
      return json(
        await previewMail(
          services.environment,
          readCookie(request, MAILBOX_COOKIE),
        ),
      );
    if (route.pattern === "/api/login") {
      requireCsrf(request, services.environment.baseURL);
      const data = await body(request),
        email = string(data.email, 254).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new HttpError(400, "请填写有效邮箱。");
      await loginLimit(
        db,
        clientIp(request, services.ipProofSecret),
        email,
        services.environment.secret,
      );
      const existing = await db.pool.query(
        "SELECT id FROM users WHERE email=$1",
        [email],
      );
      if (!existing.rowCount && releasePolicy().inviteOnly)
        await redeemInvitation(db, email, string(data.invitationCode));
      const mailbox = newMailbox();
      await services.auth.api.signInMagicLink({
        headers: request.headers,
        body: {
          email,
          name:
            typeof data.name === "string" && data.name.trim()
              ? string(data.name, 80)
              : (email.split("@")[0] ?? "读者"),
          callbackURL: "/projects",
          metadata: { previewMailbox: hash(mailbox) },
        },
      });
      return json(
        { sent: true, previewMailbox: services.environment.preview },
        200,
        {
          "Set-Cookie": cookie(
            MAILBOX_COOKIE,
            mailbox,
            runtimeSettings().security.magicLinkMinutes * 60,
          ),
        },
      );
    }
    const user = await authenticated(request, services);
    actorId = user.id;
    resourceRequest = !!route.resource;
    const adminAction: AdminAction | undefined = route.pattern.startsWith(
      "/api/admin",
    )
      ? route.pattern.endsWith("/invitations")
        ? "invitation_create"
        : route.resource === "accountId"
          ? "account_unfreeze"
          : "dashboard_data"
      : undefined;
    const owned =
      route.resource === "projectId" || route.resource === "runId"
        ? await requireOwnership(db, user.id, {
            [route.resource]: params[route.resource],
          } as Resource)
        : undefined;
    if (route.resource === "checkoutId")
      await requireOwnership(db, user.id, {
        checkoutId: params.checkoutId ?? "",
      });
    if (route.resource === "accountId")
      await requireOwnership(
        db,
        user.id,
        { accountId: params.accountId ?? "" },
        services.adminEmails,
      );
    if (request.method !== "GET")
      requireCsrf(request, services.environment.baseURL);
    if (adminAction && !isAdmin(services, user.email)) {
      throw new HttpError(404, "资源不存在。");
    }
    if (route.pattern === "/api/session")
      return json({ user, admin: isAdmin(services, user.email) });
    if (route.pattern === "/api/settings") {
      const settings = runtimeSettings();
      return json({
        calibration: settings.calibration,
        billing: settings.billing,
        release: releasePolicy(),
        mode: process.env.MODEL_MODE ?? "faux",
        scenarios: services.environment.preview ? FAUX_SCENARIOS : [],
      });
    }
    if (route.pattern === "/api/projects" && request.method === "GET")
      return json(
        (
          await db.pool.query(
            "SELECT p.id,p.title,p.project_key,p.created_at,(SELECT count(*)::int FROM pipeline_runs r WHERE r.project_id=p.id AND r.status LIKE 'AWAITING%') AS pending FROM projects p WHERE p.owner_id=$1 ORDER BY p.created_at DESC",
            [user.id],
          )
        ).rows,
      );
    if (
      (route.pattern === "/api/projects" && request.method === "POST") ||
      route.pattern === "/api/projects/import"
    ) {
      const importing = route.pattern.endsWith("/import"),
        data = importing
          ? {
              title: url.searchParams.get("title") ?? "导入项目",
              mode: "blank",
            }
          : await body(request);
      const title = string(data.title, 100),
        id = randomUUID(),
        demo = !importing && data.mode === "demo";
      const bytes = importing
        ? await limitedBody(request, runtimeSettings().security.maxUploadBytes)
        : undefined;
      await db.transaction(async (client) => {
        await client.query(
          "INSERT INTO projects(id,owner_id,project_key,title) VALUES($1,$2,$3,$4)",
          [id, user.id, demo ? "demo-ruwen" : `project-${id}`, title],
        );
      });
      const fs = (await requireOwnership(db, user.id, { projectId: id })).fs;
      try {
        if (importing && bytes) await importProjectZip(fs, bytes);
        else if (demo)
          await importProjectZip(
            fs,
            await exportProjectZip(
              new LocalDirFS(
                path.join(
                  services.environment.workspaceRoot,
                  "fixtures/demo-project",
                ),
              ),
            ),
          );
        else await initProject(fs, `project-${id}`);
        if (importing) {
          const registered = await registry.readRegistry(fs);
          const projects = new Set(
            registered.resources
              .map((resource) => resource.scope.project)
              .filter((value) => typeof value === "string"),
          );
          if (projects.size !== 1)
            throw new HttpError(400, "导入资料的项目身份不一致。");
          const projectKey = [...projects][0];
          if (typeof projectKey === "string")
            await db.pool.query(
              "UPDATE projects SET project_key=$2 WHERE id=$1 AND owner_id=$3",
              [id, projectKey, user.id],
            );
        }
      } catch (error) {
        await db.pool.query(
          "DELETE FROM projects WHERE id=$1 AND owner_id=$2",
          [id, user.id],
        );
        throw error;
      }
      return json({ id }, 201);
    }
    if (owned && route.resource === "projectId") {
      if (
        route.pattern.endsWith("/readiness") ||
        route.pattern === "/api/projects/:projectId"
      )
        return json({
          project: owned.project,
          readiness: await checks.projectReadiness(owned.fs),
          state: await state.loadState(owned.fs).catch(() => null),
        });
      if (route.pattern.endsWith("/files")) {
        const p = url.searchParams.get("path");
        if (!p) return json({ paths: await owned.fs.list() });
        try {
          return json({
            path: owned.fs.path(p),
            sha256: await owned.fs.sha256(p),
            text: await owned.fs.readText(p),
          });
        } catch {
          throw new HttpError(404, "文件不存在。");
        }
      }
      if (route.pattern.endsWith("/export"))
        return new Response(
          new Uint8Array(await exportProjectZip(owned.fs)).buffer,
          {
            headers: {
              "Content-Type": "application/zip",
              "Content-Disposition": `attachment; filename="ruwen-${owned.project.id}.zip"`,
              "Cache-Control": "no-store",
            },
          },
        );
      if (route.pattern.endsWith("/runs"))
        return json(
          (
            await db.pool.query(
              "SELECT id,chapter,kind,status,created_at FROM pipeline_runs WHERE project_id=$1 ORDER BY created_at DESC",
              [owned.project.id],
            )
          ).rows,
        );
      if (route.pattern.endsWith("/chapters")) {
        const data = await body(request),
          chapter = String(data.chapter ?? "");
        if (!/^\d{1,4}$/.test(chapter))
          throw new HttpError(400, "章节号需要1–4位数字。");
        if (
          data.simulation !== undefined &&
          (!services.environment.preview ||
            !(FAUX_SCENARIOS as readonly unknown[]).includes(data.simulation))
        )
          throw new HttpError(400, "模拟场景仅在本地预览中使用。");
        return json(
          {
            id: await services.worker.enqueueChapter(owned.fs, {
              chapter,
              ...(typeof data.simulation === "string"
                ? { simulation: data.simulation }
                : {}),
            }),
          },
          202,
        );
      }
    }
    if (owned && route.resource === "runId") {
      const id = params.runId ?? "";
      if (route.pattern.endsWith("/events"))
        return events(request, services, user.id, id);
      if (request.method === "GET")
        return json(await runDetail(services, user.id, id));
      if (route.pattern.endsWith("/cancel")) {
        await services.worker.cancel(owned.fs, id);
        return json({ accepted: true }, 202);
      }
      const data = await body(request);
      if (route.pattern.endsWith("/return")) {
        if (
          !(await owned.fs.exists(runPath(id))) ||
          (await loadRun(owned.fs, id)).status !== "AWAITING_CANDIDATE_APPROVAL"
        )
          throw new HttpError(
            409,
            "当前没有等待退回的候选稿，请刷新核对状态。",
          );
        return json(
          await services.worker.returnCandidate(
            owned.fs,
            id,
            string(data.reason, 1000),
          ),
        );
      }
      if (!(await owned.fs.exists(runPath(id))))
        throw new HttpError(409, "运行尚未生成待批准内容，请稍后查看。");
      const kind = route.pattern.endsWith("/approve-candidate")
          ? "candidate"
          : "memory",
        run = await loadRun(owned.fs, id),
        target =
          kind === "candidate" ? run.paths.candidate : run.paths.memory_preview;
      if (
        run.status !==
        (kind === "candidate"
          ? "AWAITING_CANDIDATE_APPROVAL"
          : "AWAITING_MEMORY_APPROVAL")
      )
        throw new HttpError(409, "当前运行不在等待这项批准，请刷新核对状态。");
      if (data.confirmed !== true || !target)
        throw new HttpError(400, "需要明确批准当前预览。");
      const current = await owned.fs.sha256(target);
      if (data.expectedSha256 !== current)
        throw new HttpError(409, "内容已改变，请重新阅读后批准。");
      await services.worker.enqueueApproval(owned.fs, id, kind, {
        confirmed: true,
        expectedSha256: current,
        ...(typeof data.expectedTargetSha256 === "string"
          ? { expectedTargetSha256: data.expectedTargetSha256 }
          : {}),
      });
      return json({ accepted: true }, 202);
    }
    if (route.pattern === "/api/account")
      return json({
        user,
        ...(await billingAccount(db, user.id, payments().enabled)),
      });
    if (route.pattern === "/api/billing/checkout") {
      if (!payments().enabled)
        throw new BillingError(
          "BILLING_DISABLED",
          403,
          "测试支付尚未开放，真实收费保持关闭。",
        );
      const data = await body(request);
      if (
        Object.keys(data).some(
          (key) => !["planId", "clientRequestId"].includes(key),
        )
      )
        throw new HttpError(400, "结账参数不被允许。");
      return json(
        await payments().create(
          user.id,
          string(data.planId),
          string(data.clientRequestId),
        ),
        201,
      );
    }
    if (route.resource === "checkoutId")
      return json(
        await payments().completeMock(user.id, params.checkoutId ?? ""),
      );
    if (route.resource === "accountId") {
      const data = await body(request);
      if (data.confirmed !== true)
        throw new HttpError(400, "需要明确确认已完成人工复核。");
      const result = await unfreezeAccount(
        db,
        params.accountId ?? "",
        user.id,
        string(data.expectedFrozenAt, 80),
      );
      await auditAdmin(db.pool, user.id, "account_unfreeze", true);
      return json(result);
    }
    if (route.pattern.startsWith("/api/admin")) {
      if (!isAdmin(services, user.email))
        throw new HttpError(404, "资源不存在。");
      if (request.method === "POST") {
        const code = randomBytes(18).toString("hex");
        await db.transaction(async (client) => {
          await client.query(
            "INSERT INTO web_invitations(token_hash,max_uses) VALUES($1,1)",
            [hash(code)],
          );
          await auditAdmin(client, user.id, "invitation_create", true);
        });
        return json({ code });
      }
      await auditAdmin(db.pool, user.id, "dashboard_data", true);
      return json({
        security: await adminRiskReview(db),
        users: (await db.pool.query("SELECT count(*)::int count FROM users"))
          .rows[0]?.count,
        projects: (
          await db.pool.query("SELECT count(*)::int count FROM projects")
        ).rows[0]?.count,
        failures: (
          await db.pool.query(
            "SELECT r.id,r.role_id,r.status,r.started_at FROM role_runs r WHERE r.status='failed' ORDER BY r.started_at DESC LIMIT 50",
          )
        ).rows,
        release: releasePolicy(),
      });
    }
    throw new HttpError(404, "接口不存在。");
  } catch (error) {
    if (actorId && new URL(request.url).pathname.startsWith("/api/admin")) {
      const pathname = new URL(request.url).pathname;
      await auditAdmin(
        services.worker.db.pool,
        actorId,
        pathname.endsWith("/unfreeze")
          ? "account_unfreeze"
          : pathname.endsWith("/invitations")
            ? "invitation_create"
            : "dashboard_data",
        false,
      );
    }

    if (
      error instanceof HttpError &&
      [404, 429].includes(error.status) &&
      actorId &&
      resourceRequest
    )
      await services.worker.db.pool.query(
        "INSERT INTO security_events(user_id,kind,score) VALUES($1,$2,1)",
        [actorId, error.status === 404 ? "access_denied" : "rate_limited"],
      );
    if (error instanceof BillingError)
      return json(
        {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            retryable: false,
            traceId: randomUUID(),
            issues: [],
          },
        },
        error.status,
      );
    return json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "操作未完成，请刷新核对当前状态后重试。",
      },
      error instanceof HttpError ? error.status : 500,
    );
  }
}

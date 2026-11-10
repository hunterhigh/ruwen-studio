import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { Database } from "@ruwen/db";
import { runtimeSettings } from "../../../../config/settings.ts";
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const CSRF_COOKIE = "__Host-ruwen.csrf";
export const MAILBOX_COOKIE = "__Host-ruwen.mailbox";
export const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
export function readCookie(request: Request, name: string) {
  return (request.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
export function csrfToken(request: Request) {
  const existing = readCookie(request, CSRF_COOKIE);
  return existing && /^[a-f0-9]{64}$/.test(existing)
    ? existing
    : randomBytes(32).toString("hex");
}
export function requireCsrf(request: Request, origin: string) {
  if (
    request.headers.get("origin") !== new URL(origin).origin ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new HttpError(403, "请求来源不被允许，请从工作室页面重试。");
  const header = request.headers.get("x-csrf-token") ?? "",
    stored = readCookie(request, CSRF_COOKIE) ?? "";
  if (
    !/^[a-f0-9]{64}$/.test(header) ||
    !/^[a-f0-9]{64}$/.test(stored) ||
    !timingSafeEqual(Buffer.from(header), Buffer.from(stored))
  )
    throw new HttpError(403, "请求校验已失效，请刷新页面后重试。");
}
/** The HTTPS entrypoint overwrites these headers from the actual socket; arbitrary XFF is never trusted. */
export function clientIp(request: Request, proofSecret: string) {
  const ip = request.headers.get("x-ruwen-client-ip") ?? "unknown";
  const proof = request.headers.get("x-ruwen-ip-proof") ?? "";
  const expected = createHmac("sha256", proofSecret).update(ip).digest("hex");
  return /^[a-f0-9]{64}$/.test(proof) &&
    timingSafeEqual(Buffer.from(proof), Buffer.from(expected))
    ? ip
    : "untrusted-ip";
}
export async function loginLimit(
  db: Database,
  ip: string,
  email: string | undefined,
  secret: string,
) {
  const settings = runtimeSettings().security;
  const buckets: [string, number][] = [[`ip:${ip}`, settings.loginIpLimit]];
  if (email)
    buckets.push([
      `email:${email.trim().toLowerCase()}`,
      settings.loginEmailLimit,
    ]);
  for (const [key, max] of buckets) {
    const keyHash = createHmac("sha256", secret).update(key).digest("hex");
    const row = await db.pool.query<{ attempts: string }>(
      `INSERT INTO web_rate_limits(key_hash) VALUES($1) ON CONFLICT(key_hash) DO UPDATE SET
      attempts=CASE WHEN web_rate_limits.window_started_at < now()-($2*interval '1 second') THEN 1 ELSE web_rate_limits.attempts+1 END,
      window_started_at=CASE WHEN web_rate_limits.window_started_at < now()-($2*interval '1 second') THEN now() ELSE web_rate_limits.window_started_at END RETURNING attempts`,
      [keyHash, settings.loginWindowSeconds],
    );
    if (Number(row.rows[0]?.attempts) > max)
      throw new HttpError(429, "登录请求过多，请稍后再试。");
  }
}
export function securityHeaders(
  nonce: string,
  development = false,
): Record<string, string> {
  return {
    "Content-Security-Policy": `default-src 'self'; script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""}; style-src 'self' 'nonce-${nonce}'; img-src 'self'; font-src 'self'; connect-src 'self'${development ? " wss://localhost:* wss://127.0.0.1:*" : ""}; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}

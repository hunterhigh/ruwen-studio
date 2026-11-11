import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type Database, schema } from "@ruwen/db";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins/magic-link";
import nodemailer from "nodemailer";
import { releasePolicy, runtimeSettings } from "../../../../config/settings.ts";
import { disposableEmail } from "./email-policy.ts";
import {
  COOKIE_PREFIX,
  clientIp,
  HttpError,
  hash,
  loginLimit,
} from "./security.ts";

export interface AuthEnvironment {
  baseURL: string;
  secret: string;
  workspaceRoot: string;
  preview: boolean;
  smtpUrl?: string;
  smtpFrom?: string;
  googleClientId?: string;
  googleClientSecret?: string;
}
export function createWebAuth(db: Database, options: AuthEnvironment) {
  const supportedEmail = (email: string) => {
    if (disposableEmail(email))
      throw new APIError("FORBIDDEN", {
        message: "暂不支持此邮箱服务，请使用常用邮箱。",
      });
  };
  return betterAuth({
    appName: "如文工作室",
    baseURL: options.baseURL,
    secret: options.secret,
    database: drizzleAdapter(db.orm, {
      provider: "pg",
      schema: {
        user: schema.users,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: true,
      defaultCookieAttributes: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
      cookiePrefix: COOKIE_PREFIX,
    },
    session: { expiresIn: runtimeSettings().preview.sessionHours * 3600 },
    logger: { disabled: true },
    socialProviders:
      options.googleClientId && options.googleClientSecret
        ? {
            google: {
              clientId: options.googleClientId,
              clientSecret: options.googleClientSecret,
            },
          }
        : {},
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            const account = (
              await db.pool.query<{ email: string }>(
                "SELECT email FROM users WHERE id=$1",
                [session.userId],
              )
            ).rows[0];
            if (account) supportedEmail(account.email);
            if (context?.path?.startsWith("/callback/") && context.request) {
              const user = await db.pool.query<{ email: string }>(
                "SELECT email FROM users WHERE id=$1",
                [session.userId],
              );
              if (user.rows[0])
                await loginLimit(
                  db,
                  clientIp(
                    context.request,
                    process.env.RUWEN_IP_PROOF_SECRET ?? options.secret,
                  ),
                  user.rows[0].email,
                  options.secret,
                );
            }
          },
        },
      },
      user: {
        create: {
          before: async (user) => {
            supportedEmail(user.email);
            if (releasePolicy().inviteOnly) {
              const granted = await db.pool.query(
                "SELECT email FROM web_invite_grants WHERE email=$1 AND expires_at>now()",
                [user.email.toLowerCase()],
              );
              if (!granted.rowCount)
                throw new APIError("FORBIDDEN", {
                  message: "注册需要有效的邀请码。",
                });
            }
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: runtimeSettings().security.magicLinkMinutes * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url, metadata }) => {
          supportedEmail(email);
          if (options.preview) {
            const digest = metadata?.previewMailbox;
            if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))
              throw new Error(
                "Preview mailbox must be bound to the requesting browser",
              );
            const directory = path.join(
              options.workspaceRoot,
              ".local/mailbox",
            );
            await mkdir(directory, { recursive: true });
            await writeFile(
              path.join(directory, `${digest}.json`),
              JSON.stringify({
                email,
                url,
                expiresAt:
                  Date.now() +
                  runtimeSettings().security.magicLinkMinutes * 60_000,
              }),
              { mode: 0o600 },
            );
            return;
          }
          if (!options.smtpUrl) throw new Error("邮件服务尚未配置");
          await nodemailer.createTransport(options.smtpUrl).sendMail({
            from: options.smtpFrom ?? "如文工作室 <noreply@localhost>",
            to: email,
            subject: "登录如文工作室",
            text: `请打开此链接登录，有效期${runtimeSettings().security.magicLinkMinutes}分钟：\n${url}\n若非本人操作，请忽略。`,
          });
        },
      }),
    ],
  });
}
export type WebAuth = ReturnType<typeof createWebAuth>;
export async function seedPreviewInvitation(db: Database) {
  const code = runtimeSettings().preview.invitationCode;
  await db.pool.query(
    "INSERT INTO web_invitations(token_hash,max_uses) VALUES($1,10000) ON CONFLICT DO NOTHING",
    [hash(code)],
  );
}
export async function redeemInvitation(
  db: Database,
  email: string,
  code: string,
) {
  await db.transaction(async (client) => {
    const row = await client.query<{ id: string }>(
      "UPDATE web_invitations SET uses=uses+1 WHERE token_hash=$1 AND uses<max_uses AND (expires_at IS NULL OR expires_at>now()) RETURNING id",
      [hash(code)],
    );
    if (!row.rows[0]) throw new HttpError(400, "邀请码无效或已用完。");
    await client.query(
      "INSERT INTO web_invite_grants(email,invitation_id,expires_at) VALUES($1,$2,now()+interval '1 day') ON CONFLICT(email) DO UPDATE SET invitation_id=excluded.invitation_id,expires_at=excluded.expires_at",
      [email.toLowerCase(), row.rows[0].id],
    );
  });
}
export const newMailbox = () => randomBytes(32).toString("hex");
export async function previewMail(
  options: AuthEnvironment,
  token: string | undefined,
) {
  if (!options.preview || !token || !/^[a-f0-9]{64}$/.test(token))
    throw new HttpError(404, "资源不存在。");
  try {
    const value = JSON.parse(
      await readFile(
        path.join(
          options.workspaceRoot,
          ".local/mailbox",
          `${hash(token)}.json`,
        ),
        "utf8",
      ),
    ) as { email: string; url: string; expiresAt: number };
    if (value.expiresAt <= Date.now()) throw new Error("expired");
    return value;
  } catch {
    throw new HttpError(404, "登录邮件尚未到达或已过期。");
  }
}

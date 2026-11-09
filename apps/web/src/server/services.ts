import { createApplicationRuntime } from "@ruwen/agents";
import { WorkerService } from "worker";
import { runtimeSettings } from "../../../../config/settings.ts";
import {
  type AuthEnvironment,
  createWebAuth,
  seedPreviewInvitation,
} from "./auth.ts";
export interface WebServices {
  worker: WorkerService;
  auth: ReturnType<typeof createWebAuth>;
  environment: AuthEnvironment;
  ipProofSecret: string;
  adminEmails: string[];
}
const globalServices = globalThis as typeof globalThis & {
  ruwenWeb?: Promise<WebServices>;
};
export function getServices(): Promise<WebServices> {
  if (globalServices.ruwenWeb) return globalServices.ruwenWeb;
  globalServices.ruwenWeb = (async () => {
    const url = process.env.DATABASE_URL,
      secret = process.env.BETTER_AUTH_SECRET;
    if (!url || !secret || secret.length < 32)
      throw new Error(
        "DATABASE_URL and a 32+ character BETTER_AUTH_SECRET are required",
      );
    const root = process.env.RUWEN_WORKSPACE_ROOT;
    if (!root) throw new Error("RUWEN_WORKSPACE_ROOT is required");
    const preview =
      process.env.LOCAL_PREVIEW === "1" &&
      process.env.NODE_ENV !== "production" &&
      ["faux", "replay"].includes(process.env.MODEL_MODE ?? "");
    const environment: AuthEnvironment = {
      baseURL: process.env.BETTER_AUTH_URL ?? "https://localhost:3000",
      secret,
      workspaceRoot: root,
      preview,
      ...(process.env.SMTP_URL ? { smtpUrl: process.env.SMTP_URL } : {}),
      ...(process.env.SMTP_FROM ? { smtpFrom: process.env.SMTP_FROM } : {}),
      ...(process.env.GOOGLE_CLIENT_ID
        ? { googleClientId: process.env.GOOGLE_CLIENT_ID }
        : {}),
      ...(process.env.GOOGLE_CLIENT_SECRET
        ? { googleClientSecret: process.env.GOOGLE_CLIENT_SECRET }
        : {}),
    };
    const worker = new WorkerService(url, {
      ...(process.env.WORKER_QUEUE ? { queue: process.env.WORKER_QUEUE } : {}),
      runtime: () =>
        createApplicationRuntime({
          mode: process.env.MODEL_MODE ?? "faux",
          workspaceRoot: root,
          scenario: runtimeSettings().faux.scenario,
          ...(process.env.FAUX_CHARACTER_DELAY_MS
            ? { characterDelayMs: Number(process.env.FAUX_CHARACTER_DELAY_MS) }
            : {}),
        }),
    });
    await worker.start(false);
    if (preview) await seedPreviewInvitation(worker.db);
    return {
      worker,
      auth: createWebAuth(worker.db, environment),
      environment,
      ipProofSecret: process.env.RUWEN_IP_PROOF_SECRET ?? secret,
      adminEmails: (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    };
  })();
  return globalServices.ruwenWeb;
}

import { json } from "../../../../server/api.ts";
import {
  clientIp,
  HttpError,
  loginLimit,
  requireCsrf,
} from "../../../../server/security.ts";
import { getServices } from "../../../../server/services.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return (await getServices()).auth.handler(request);
}
export async function POST(request: Request) {
  try {
    const services = await getServices();
    requireCsrf(request, services.environment.baseURL);
    if (new URL(request.url).pathname.includes("/sign-in/")) {
      const data: unknown = await request.clone().json();
      const email =
        data &&
        typeof data === "object" &&
        "email" in data &&
        typeof data.email === "string"
          ? data.email
          : undefined;
      await loginLimit(
        services.worker.db,
        clientIp(request, services.ipProofSecret),
        email,
        services.environment.secret,
      );
    }
    return services.auth.handler(request);
  } catch (error) {
    return json(
      {
        error: error instanceof HttpError ? error.message : "登录请求未完成。",
      },
      error instanceof HttpError ? error.status : 500,
    );
  }
}

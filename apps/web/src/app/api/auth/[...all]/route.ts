import { handleAuthPost } from "../../../../server/auth-request.ts";
import { getServices } from "../../../../server/services.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return (await getServices()).auth.handler(request);
}
export async function POST(request: Request) {
  return handleAuthPost(request, await getServices());
}

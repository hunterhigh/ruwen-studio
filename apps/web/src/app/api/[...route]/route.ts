import { handleApi } from "../../../server/api.ts";
import { getServices } from "../../../server/services.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return await handleApi(request, await getServices());
  } catch (error) {
    if (new URL(request.url).pathname === "/api/health")
      return Response.json(
        { ok: false },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    throw error;
  }
}
export async function POST(request: Request) {
  return handleApi(request, await getServices());
}

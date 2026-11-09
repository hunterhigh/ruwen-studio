import { handleApi } from "../../../server/api.ts";
import { getServices } from "../../../server/services.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleApi(request, await getServices());
}
export async function POST(request: Request) {
  return handleApi(request, await getServices());
}

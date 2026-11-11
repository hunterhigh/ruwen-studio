import { expect, it, vi } from "vitest";
import { GET } from "../src/app/api/[...route]/route.ts";

vi.mock("../src/server/services.ts", () => ({
  getServices: vi.fn(async () => {
    throw new Error("postgres://secret manuscript");
  }),
}));
it("public readiness reports 503 without diagnostics when service startup cannot complete", async () => {
  const response = await GET(new Request("https://localhost/api/health"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false });
  expect(response.headers.get("cache-control")).toBe("no-store");
});

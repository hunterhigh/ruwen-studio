import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadIdeationDecisions } from "./useProjectDecisions.ts";

const mocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  previews: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../ideation/client.ts", async (original) => ({
  ...(await original<typeof import("../ideation/client.ts")>()),
  createIdeationClient: () => ({
    api: { listIdeationSessions: mocks.sessions, listPreviews: mocks.previews },
    dispose: mocks.dispose,
  }),
}));
const page = (items: unknown[], nextCursor: string | null = null) => ({
  ok: true,
  value: { items, nextCursor },
});
beforeEach(() => vi.resetAllMocks());

describe("project decision aggregation", () => {
  it("reads every sessions page before selecting the newest ten, and every preview page", async () => {
    const sessions = Array.from({ length: 12 }, (_, i) => ({
      id: `session-${i}`,
      // A tie must preserve newest-first server ordinal order too.
      createdAt: "2026-11-18T00:00:00.000Z",
      status: i === 11 ? "closed" : "open",
    }));
    mocks.sessions.mockImplementation(async ({ after }) =>
      after ? page(sessions.slice(6)) : page(sessions.slice(0, 6), "6"),
    );
    mocks.previews.mockImplementation(async ({ sessionId, after }) =>
      after
        ? page([{ id: `${sessionId}-2`, status: "pending" }])
        : page(
            [
              { id: `${sessionId}-1`, status: "pending" },
              { id: `${sessionId}-old`, status: "approved" },
              { id: `${sessionId}-stale`, status: "stale" },
            ],
            "3",
          ),
    );
    const result = await loadIdeationDecisions("project-a");
    expect(mocks.sessions).toHaveBeenCalledTimes(2);
    expect(mocks.previews).toHaveBeenCalledTimes(20);
    expect(result).toHaveLength(20);
    expect(new Set(result.map((item) => item.session.id))).toEqual(
      new Set(sessions.slice(2).map((session) => session.id)),
    );
    expect(result[0]?.session.id).toBe("session-11");
    expect(result.every((item) => item.preview.status === "pending")).toBe(
      true,
    );
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
  it("sorts by actual creation time rather than title or update time", async () => {
    mocks.sessions.mockResolvedValue(
      page([
        { id: "new", createdAt: "2026-11-18T00:00:00.000Z" },
        { id: "old", createdAt: "2026-01-01T00:00:00.000Z" },
      ]),
    );
    mocks.previews.mockImplementation(async ({ sessionId }) =>
      page([{ id: sessionId, status: "pending" }]),
    );
    expect(
      (await loadIdeationDecisions("project-a")).map((x) => x.session.id),
    ).toEqual(["new", "old"]);
  });
  it("discards all partial ideation data if a later preview page fails", async () => {
    mocks.sessions.mockResolvedValue(
      page([{ id: "s", createdAt: "2026-11-18T00:00:00.000Z" }]),
    );
    mocks.previews
      .mockResolvedValueOnce(page([{ status: "pending" }], "1"))
      .mockResolvedValueOnce({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await loadIdeationDecisions("project-a")).toEqual([]);
  });
  it("degrades silently on a failed session page, transport error or broken cursor", async () => {
    mocks.sessions.mockResolvedValue({ ok: false });
    expect(await loadIdeationDecisions("project-a")).toEqual([]);
    mocks.sessions.mockRejectedValue(new Error("offline"));
    expect(await loadIdeationDecisions("project-a")).toEqual([]);
    mocks.sessions.mockResolvedValue(page([], "same"));
    expect(await loadIdeationDecisions("project-a")).toEqual([]);
    expect(mocks.dispose).toHaveBeenCalledTimes(3);
  });
});

import type { PoolClient } from "pg";
import { afterAll, expect, inject, it, vi } from "vitest";
import { Database } from "../src/index.ts";

const url = inject("databaseUrl");
const observer = new Database(url);
afterAll(() => observer.close());

async function backendPid(client: Pick<PoolClient, "query">) {
  const row = (
    await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
  ).rows[0];
  if (!row) throw new Error("Missing backend PID");
  return row.pid;
}

async function terminate(pid: number) {
  const result = await observer.pool.query<{ terminated: boolean }>(
    "SELECT pg_terminate_backend($1, 5000) AS terminated",
    [pid],
  );
  expect(result.rows[0]?.terminated).toBe(true);
}

it("discards terminated idle connections and logs only safe structured fields", async () => {
  const target = new Database(url);
  const write = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true);
  try {
    const first = await target.checkout();
    const second = await target.checkout();
    let pids: number[];
    try {
      pids = await Promise.all([
        backendPid(first.client),
        backendPid(second.client),
      ]);
    } finally {
      first.release();
      second.release();
    }
    expect(target.pool.idleCount).toBe(2);
    await Promise.all(pids.map(terminate));
    await vi.waitFor(() => expect(target.pool.totalCount).toBe(0));
    expect(pids).not.toContain(await backendPid(target.pool));
    expect(write.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual(
      Array.from({ length: 2 }, () => ({
        event: "postgres_connection_error",
        source: "idle_pool",
        error_code: "57P01",
      })),
    );
    target.pool.emit("error", Object.assign(new Error(url), { code: url }));
    const records = write.mock.calls.map(([line]) => String(line)).join("");
    const password = new URL(url).password;
    expect(records.includes(url)).toBe(false);
    if (password) expect(records.includes(password)).toBe(false);
    expect(JSON.parse(String(write.mock.lastCall?.[0]))).toEqual({
      event: "postgres_connection_error",
      source: "idle_pool",
    });
  } finally {
    await target.close();
    write.mockRestore();
  }
});

it("preserves the original active transaction error and retires the terminated backend", async () => {
  const target = new Database(url);
  let pid = 0;
  let original: unknown;
  const releases: unknown[] = [];
  target.pool.on("release", (error) => releases.push(error));
  try {
    const failure = target.transaction(async (client) => {
      pid = await backendPid(client);
      await Promise.all([
        client.query("SELECT pg_sleep(15)").catch((error) => {
          original = error;
          throw error;
        }),
        terminate(pid),
      ]);
    });
    await expect(failure).rejects.toMatchObject({ code: "57P01" });
    await expect(failure).rejects.toBe(original);
    expect(releases).toEqual([original]);
    expect(target.pool.totalCount).toBe(0);
    expect(await backendPid(target.pool)).not.toBe(pid);
  } finally {
    await target.close();
  }
});

it("throws the callback error when rollback fails and discards the session", async () => {
  const target = new Database(url);
  const original = new Error("transaction callback failed");
  const rollback = new Error("rollback failed");
  const releases: unknown[] = [];
  target.pool.on("release", (error) => releases.push(error));
  try {
    await expect(
      target.transaction(async (client) => {
        vi.spyOn(client, "query").mockRejectedValueOnce(rollback);
        throw original;
      }),
    ).rejects.toBe(original);
    expect(releases).toEqual([rollback]);
    expect(target.pool.totalCount).toBe(0);
    expect(await backendPid(target.pool)).toBeGreaterThan(0);
  } finally {
    await target.close();
  }
});

it("observes LISTEN loss and delivers later notifications on a new subscribed session", async () => {
  const target = new Database(url);
  const received: string[] = [];
  const channel = "ruwen_test_connection_errors";
  const notify = (text: string) =>
    observer.pool.query("SELECT pg_notify($1,$2)", [channel, text]);
  try {
    const first = await target.checkout();
    let pid: number;
    try {
      first.client.on("notification", (message) =>
        received.push(message.payload ?? ""),
      );
      await first.client.query(`LISTEN ${channel}`);
      pid = await backendPid(first.client);
      await notify("first");
      await vi.waitFor(() => expect(received).toEqual(["first"]));
      await terminate(pid);
      await vi.waitFor(() =>
        expect(first.error).toMatchObject({ code: "57P01" }),
      );
    } finally {
      first.release();
    }
    await notify("while-disconnected");
    const second = await target.checkout();
    try {
      expect(await backendPid(second.client)).not.toBe(pid);
      second.client.on("notification", (message) =>
        received.push(message.payload ?? ""),
      );
      await second.client.query(`LISTEN ${channel}`);
      await notify("after-reconnecting");
      await vi.waitFor(() =>
        expect(received).toEqual(["first", "after-reconnecting"]),
      );
    } finally {
      second.release(new Error("Temporary LISTEN session completed"));
    }
  } finally {
    await target.close();
  }
});

it("waits for the socket to end before reporting that the pool is closed", async () => {
  const target = new Database(url);
  const session = await target.checkout();
  const ended = vi.fn();
  session.client.once("end", ended);
  session.release();
  await target.close();
  expect(ended).toHaveBeenCalledOnce();
});

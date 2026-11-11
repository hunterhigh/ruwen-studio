import { createServer } from "node:http";
import type { Database } from "../packages/db/src/index.ts";

const probes = new WeakMap<Database, Promise<boolean>>();

/** A bounded probe: no DSN, SQL, exception or manuscript in the response. */
export async function databaseReady(db: Database) {
  let probe = probes.get(db);
  if (!probe) {
    const query = {
      text: "SELECT 1 FROM ruwen_migrations LIMIT 1",
      query_timeout: 2000,
    };
    probe = db.pool
      .query(query)
      .then(
        () => true,
        () => false,
      )
      .finally(() => probes.delete(db));
    probes.set(db, probe);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 2500);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function workerHealth(db: Database, port: number, host = "127.0.0.1") {
  let ready = false;
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" || request.url !== "/health") {
      response.writeHead(404).end();
      return;
    }
    const ok = ready && (await databaseReady(db));
    response
      .writeHead(ok ? 200 : 503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      })
      .end(JSON.stringify({ ok }));
  });
  return {
    server,
    setReady(value: boolean) {
      ready = value;
    },
    listen: () =>
      new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        ready = false;
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

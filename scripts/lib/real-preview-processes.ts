import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, realpath } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { safeLogRecord } from "../../config/observability.ts";
import { realPreviewCoordinates } from "../../config/real-preview.ts";
import { Database } from "../../packages/db/src/index.ts";

export function previewLogLine(line: string) {
  try {
    const data = JSON.parse(line) as Record<string, unknown>;
    return JSON.stringify(
      safeLogRecord(
        typeof data.event === "string" ? data.event : "library_output",
        data,
      ),
    );
  } catch {
    return null;
  }
}
async function freePort(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}
/** No model client is created here. It starts the already-authorized services with one inherited environment. */
export async function startRealPreviewProcesses(
  root: string,
  environment: NodeJS.ProcessEnv,
  output: (text: string) => void,
) {
  const config = realPreviewCoordinates(),
    children: ChildProcess[] = [];
  let stopping = false,
    failure = false;
  const exited = new WeakMap<ChildProcess, Promise<void>>();
  const kinds = new WeakMap<ChildProcess, string>();
  const ready = new WeakSet<ChildProcess>();
  const child = (script: string, args: string[] = [], database = false) => {
    const env = { ...environment };
    if (database) delete env.DEEPSEEK_API_KEY;
    const process = spawn(globalThis.process.execPath, [script, ...args], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.push(process);
    kinds.set(process, database ? "database" : (args[0] ?? "service"));
    exited.set(
      process,
      new Promise<void>((resolve) => {
        process.once("exit", resolve);
        process.once("error", resolve);
      }),
    );
    const safeOutput = (stream: NodeJS.ReadableStream | null) => {
      let pending = "";
      stream?.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) {
          const safe = previewLogLine(line);
          if (safe) {
            const event = (JSON.parse(safe) as { event: string }).event;
            if (event === `${args[0]}_ready`) ready.add(process);
            output(safe);
          }
        }
        if (pending.length > 16384) pending = "";
      });
    };
    safeOutput(process.stdout);
    safeOutput(process.stderr);
    process.once("error", () => {
      failure = true;
      globalThis.process.exitCode = 1;
      output("子服务无法启动，已停止本次预览。");
      void stop();
    });
    process.once("exit", () => {
      if (!stopping) {
        failure = true;
        globalThis.process.exitCode = 1;
        output("子服务已退出，正在停止本次预览。");
        void stop();
      }
    });
    return process;
  };
  const stopOne = async (process: ChildProcess) => {
    if (process.exitCode !== null || process.signalCode !== null) return;
    if (process.connected)
      process.send({ type: "ruwen-preview-stop" }, () => {});
    else process.kill("SIGTERM");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        exited.get(process),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, config.shutdownTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (process.exitCode === null && process.signalCode === null)
      process.kill("SIGTERM");
  };
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    const priority = (process: ChildProcess) =>
      kinds.get(process) === "worker"
        ? 0
        : kinds.get(process) === "web"
          ? 1
          : 2;
    for (const process of [...children].sort(
      (a, b) => priority(a) - priority(b),
    ))
      await stopOne(process);
    if (globalThis.process.connected) globalThis.process.disconnect();
  };
  const onSignal = () => {
    void stop();
  };
  globalThis.process.once("SIGINT", onSignal);
  globalThis.process.once("SIGTERM", onSignal);
  const onMessage = (message: unknown) => {
    if (
      message &&
      typeof message === "object" &&
      "type" in message &&
      message.type === "ruwen-preview-stop"
    )
      void stop();
  };
  globalThis.process.on("message", onMessage);
  try {
    if (!(await freePort(config.port))) throw new Error("preview_port_busy");
    await mkdir(path.dirname(environment.TLS_KEY_FILE ?? ""), {
      recursive: true,
    });
    const db = new Database(config.databaseURL);
    const expectedDirectory = path.join(
      root,
      ".local",
      config.instance,
      "postgres",
    );
    try {
      const portFree = await freePort(config.databasePort);
      if (portFree) child("scripts/dev-postgres.ts", [], true);
      const started = performance.now();
      while (!stopping) {
        try {
          const row = await db.pool.query<{ data_directory: string }>(
            "SHOW data_directory",
          );
          const actual = await realpath(row.rows[0]?.data_directory ?? ""),
            expected = await realpath(expectedDirectory);
          if (
            path.resolve(actual).toLowerCase() !==
            path.resolve(expected).toLowerCase()
          )
            throw new Error("foreign_database");
          break;
        } catch (error) {
          if (
            !portFree ||
            (error instanceof Error && error.message === "foreign_database")
          )
            throw new Error("foreign_database");
          if (failure || performance.now() - started > config.startupTimeoutMs)
            throw new Error("database_start_timeout");
          await delay(200);
        }
      }
    } finally {
      await db.close();
    }
    if (stopping) return { stop, failed: () => failure };
    const worker = child("scripts/production-entry.ts", ["worker"]);
    const web = child("scripts/production-entry.ts", ["web", "--dev"]);
    const started = performance.now();
    while (!stopping && (!ready.has(worker) || !ready.has(web))) {
      if (failure || performance.now() - started > config.startupTimeoutMs)
        throw new Error("services_start_timeout");
      await delay(100);
    }
    if (stopping) return { stop, failed: () => failure };
    output(
      `DeepSeek 本机试用（${environment.MODEL_MODE === "faux" ? "faux 演练，未调用真实模型" : "real"}）：${config.baseURL}；邀请码 RUWEN-PREVIEW。Ctrl+C 停止本次服务。`,
    );
    return { stop, failed: () => failure };
  } catch (error) {
    await stop();
    if (error instanceof Error && error.message === "preview_port_busy")
      output("3001 端口已被占用，请先关闭旧的 3001 预览；不会操作 3000。");
    else if (error instanceof Error && error.message === "foreign_database")
      output("55329 未通过独立数据库目录校验，拒绝使用该数据库。");
    else output("预览启动失败；请核对独立端口及本地依赖，不要输出 key。");
    throw new Error("Local preview did not start");
  }
}

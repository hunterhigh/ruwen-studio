import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:https";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentCanary } from "@ruwen/agents";
import type {
  NextBundlerOptions,
  NextServer,
  NextServerOptions,
} from "next/dist/server/next.js";
import { generate } from "selfsigned";
import { proxyClientIp, proxyConfiguration } from "../../../config/proxy.ts";
import { securityHeaders } from "../src/server/security.ts";

deploymentCanary();

const root = fileURLToPath(new URL("../../../", import.meta.url)),
  directory = path.join(root, ".local/tls");
const development = process.argv.includes("--dev");
const proxy = proxyConfiguration();
if (development && proxy) throw new Error("Proxy mode is production only");
Reflect.set(
  process.env,
  "NODE_ENV",
  development ? "development" : "production",
);
process.env.RUWEN_WORKSPACE_ROOT = root;
process.env.NEXT_TELEMETRY_DISABLED = "1";
process.env.RUWEN_IP_PROOF_SECRET ??= randomBytes(32).toString("hex");
const port = Number(process.env.PORT ?? 3000),
  keyFile =
    process.env.TLS_KEY_FILE ?? path.join(directory, "localhost-key.pem"),
  certFile =
    process.env.TLS_CERT_FILE ?? path.join(directory, "localhost-cert.pem");
if (development) {
  await mkdir(directory, { recursive: true });
  try {
    await readFile(keyFile);
    await readFile(certFile);
  } catch {
    const certificate = await generate(
      [{ name: "commonName", value: "localhost" }],
      {
        keySize: 2048,
        algorithm: "sha256",
        extensions: [
          {
            name: "subjectAltName",
            altNames: [
              { type: 2, value: "localhost" },
              { type: 7, ip: "127.0.0.1" },
            ],
          },
        ],
      },
    );
    await writeFile(keyFile, certificate.private, { mode: 0o600 });
    await writeFile(certFile, certificate.cert);
  }
}
const next = createRequire(import.meta.url)("next") as (
  options: NextServerOptions & NextBundlerOptions,
) => NextServer;
const app = next({
  webpack: true,
  dev: development,
  dir: fileURLToPath(new URL("../", import.meta.url)),
  hostname: "localhost",
  port,
});
await app.prepare();
const handle = app.getRequestHandler(),
  upgrade = app.getUpgradeHandler();
const proof = process.env.RUWEN_IP_PROOF_SECRET;
const prepare = (request: import("node:http").IncomingMessage) => {
  const ip = proxyClientIp(
    proxy,
    request.socket.remoteAddress ?? "unknown",
    request.headers,
  );
  request.headers["x-ruwen-client-ip"] = ip;
  request.headers["x-ruwen-ip-proof"] = createHmac("sha256", proof)
    .update(ip)
    .digest("hex");
  request.headers["x-forwarded-for"] = ip;
  if (proxy) {
    request.headers.host = proxy.publicUrl.host;
    request.headers["x-forwarded-host"] = proxy.publicUrl.host;
    request.headers["x-forwarded-proto"] = "https";
  }
  const nonce = randomBytes(24).toString("base64");
  const headers = securityHeaders(nonce, development);
  request.headers["content-security-policy"] =
    headers["Content-Security-Policy"];
  request.headers["x-nonce"] = nonce;
  return headers;
};
const listener: import("node:http").RequestListener = (request, response) => {
  // Health probes do not carry a user IP and never enter an authenticated handler.
  if (proxy && request.url === "/api/health" && request.method === "GET") {
    for (const [name, value] of Object.entries(
      securityHeaders(randomBytes(24).toString("base64"), false),
    ))
      response.setHeader(name, value);
    void handle(request, response);
    return;
  }
  try {
    for (const [name, value] of Object.entries(prepare(request)))
      response.setHeader(name, value);
  } catch {
    response.writeHead(400).end();
    return;
  }
  void handle(request, response);
};
const server = proxy
  ? createHttpServer(listener)
  : createServer(
      { key: await readFile(keyFile), cert: await readFile(certFile) },
      listener,
    );
server.on("upgrade", (request, socket, head) => {
  try {
    prepare(request);
  } catch {
    socket.destroy();
    return;
  }
  void upgrade(request, socket, head);
});
server.listen(port, proxy ? "0.0.0.0" : "127.0.0.1", () =>
  console.log(
    proxy
      ? "web_ready"
      : `如文工作室：https://localhost:${port}（仅本机HTTPS）`,
  ),
);
const stop = () => {
  server.close(() => {
    void app.close().then(() => process.exit(0));
  });
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const prefix = `ruwen-ci-${process.pid}`,
  network = `${prefix}-net`;
const names = {
  db: `${prefix}-db`,
  web: `${prefix}-web`,
  worker: `${prefix}-worker`,
};
async function docker(args: string[], allowFailure = false) {
  return await new Promise<{ code: number; output: string }>(
    (resolve, reject) => {
      const child = spawn("docker", args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.on("data", (bytes: Buffer) => {
        output += bytes.toString();
      });
      child.stderr.on("data", () => {});
      child.once("error", () =>
        reject(new Error("Docker is required for image acceptance")),
      );
      child.once("exit", (code) => {
        if (code && !allowFailure)
          reject(new Error(`Container acceptance command failed: ${args[0]}`));
        else resolve({ code: code ?? 1, output: output.trim() });
      });
    },
  );
}
const runtimeKeys = [
  "DATABASE_URL",
  "RUWEN_CANARY",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "WORKER_QUEUE",
  "HTTP_FROM_PROXY",
  "TRUST_PROXY_PROVIDER",
  "TRUSTED_PROXY_CIDRS",
  "FAUX_CHARACTER_DELAY_MS",
];
const runtimeArgs = runtimeKeys.flatMap((key) => ["--env", key]);
const readonlyArgs = [
  "--read-only",
  "--tmpfs",
  "/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges:true",
];
const webImage = process.env.CONTAINER_WEB_IMAGE ?? "ruwen-web:ci";
const workerImage = process.env.CONTAINER_WORKER_IMAGE ?? "ruwen-worker:ci";
async function waitFor(check: () => Promise<boolean>) {
  for (let n = 0; n < 60; n++) {
    if (await check()) return;
    await delay(1000);
  }
  throw new Error("Container readiness timed out");
}
try {
  process.env.POSTGRES_PASSWORD = randomBytes(32).toString("hex");
  process.env.DATABASE_URL = `postgresql://ruwen:${process.env.POSTGRES_PASSWORD}@${names.db}:5432/ruwen_staging`;
  process.env.RUWEN_CANARY = randomBytes(32).toString("hex");
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("hex");
  process.env.BETTER_AUTH_URL = "https://studio.test.invalid";
  process.env.WORKER_QUEUE = "ruwen-container-ci";
  process.env.HTTP_FROM_PROXY = "1";
  process.env.TRUST_PROXY_PROVIDER = "fly";
  // Only this isolated CI Docker network; operators must configure their actual trusted peers.
  process.env.TRUSTED_PROXY_CIDRS = "127.0.0.1/32";
  process.env.FAUX_CHARACTER_DELAY_MS = "0";
  await docker(["network", "create", network]);
  await docker([
    "run",
    "--detach",
    "--name",
    names.db,
    "--network",
    network,
    "--env",
    "POSTGRES_PASSWORD",
    "--env",
    "POSTGRES_USER=ruwen",
    "--env",
    "POSTGRES_DB=ruwen_staging",
    "postgres:18",
  ]);
  await waitFor(
    async () =>
      (
        await docker(
          [
            "exec",
            names.db,
            "pg_isready",
            "-U",
            "ruwen",
            "-d",
            "ruwen_staging",
          ],
          true,
        )
      ).code === 0,
  );
  await docker([
    "run",
    "--rm",
    "--network",
    network,
    ...readonlyArgs,
    ...runtimeArgs,
    workerImage,
    "node",
    "scripts/production-entry.ts",
    "migrate",
  ]);
  for (const service of ["worker", "web"] as const)
    await docker([
      "run",
      "--detach",
      "--name",
      names[service],
      "--network",
      network,
      ...readonlyArgs,
      ...runtimeArgs,
      service === "web" ? webImage : workerImage,
    ]);
  for (const service of ["worker", "web"] as const) {
    await waitFor(
      async () =>
        (
          await docker(
            ["exec", names[service], "node", "scripts/healthcheck.ts", service],
            true,
          )
        ).code === 0,
    );
    const inspect = await docker([
      "inspect",
      "--format",
      "{{.Config.User}}:{{.HostConfig.ReadonlyRootfs}}",
      names[service],
    ]);
    assert.equal(inspect.output, "1000:1000:true");
    await docker([
      "exec",
      "--user",
      "0",
      names[service],
      "node",
      "--input-type=module",
      "-e",
      "import {writeFileSync} from 'node:fs';try{writeFileSync('/ROOTFS_WRITE_TEST','x');process.exit(1)}catch(e){if(e.code!=='EROFS')process.exit(2)}",
    ]);
  }
  await docker([
    "exec",
    names.web,
    "node",
    "--input-type=module",
    "-e",
    `
    import assert from 'node:assert/strict';
    const headers={'fly-client-ip':'203.0.113.7','host':'studio.test.invalid'};
    const page=await fetch('http://127.0.0.1:8080/sign-in',{headers});
    assert.equal(page.status,200);
    assert(!/unsafe-inline|unsafe-eval/.test(page.headers.get('content-security-policy')));
    const csrf=await fetch('http://127.0.0.1:8080/api/csrf',{headers});
    assert.equal(csrf.status,200);
    assert.match(csrf.headers.get('set-cookie'),/HttpOnly/i);
    assert.match(csrf.headers.get('set-cookie'),/Secure/i);
    assert.match(csrf.headers.get('set-cookie'),/SameSite=Lax/i);
    const token=(await csrf.json()).token;
    const cookie=csrf.headers.get('set-cookie').split(';')[0];
    const login={email:'container-check@test.invalid',name:'容器测试',invitationCode:'INTENTIONALLY_INVALID_INVITATION'};
    const allowed=await fetch('http://127.0.0.1:8080/api/login',{method:'POST',headers:{...headers,origin:'https://studio.test.invalid','content-type':'application/json','x-csrf-token':token,cookie},body:JSON.stringify(login)});
    assert.equal(allowed.status,400); // Valid CSRF reaches invitation validation, never mail/model generation.
    assert.match((await allowed.json()).error,/邀请码/);
    const crossSite=await fetch('http://127.0.0.1:8080/api/login',{method:'POST',headers:{...headers,origin:'https://other.test.invalid','content-type':'application/json','x-csrf-token':token,cookie},body:JSON.stringify(login)});
    assert.equal(crossSite.status,403);
    const denied=await fetch('http://127.0.0.1:8080/api/projects');
    assert.equal(denied.status,400); // Missing platform IP cannot reach authentication.
    const account=await fetch('http://127.0.0.1:8080/api/account',{headers});
    assert.equal(account.status,401);
  `,
  ]);
  await docker([
    "exec",
    "--env",
    "RUN_CONTAINER_ACCEPTANCE=1",
    names.worker,
    "node",
    "scripts/container-chapter-smoke.ts",
  ]);
  for (const service of ["worker", "web"] as const) {
    await docker(["stop", "--time", "30", names[service]]);
    assert.equal(
      (
        await docker([
          "inspect",
          "--format",
          "{{.State.ExitCode}}",
          names[service],
        ])
      ).output,
      "0",
    );
  }
  process.stdout.write(
    `${JSON.stringify({ event: "container_acceptance_passed", services: 2, nonRoot: true, readonlyRootfs: true, independentMigration: true, databaseHealth: true, proxyCookiesAndCsp: true, gracefulShutdown: true, readonlyFauxChapter: true })}\n`,
  );
} catch {
  process.stderr.write('{"event":"container_acceptance_failed"}\n');
  // Application entrypoints already restrict logs to operational metadata.
  for (const service of ["web", "worker"] as const) {
    const logs = await docker(["logs", names[service]], true);
    for (const line of logs.output.split("\n")) {
      try {
        const record = JSON.parse(line) as { event?: string };
        if (
          /^(?:startup_failed|worker_error|web_ready|worker_ready|library_output)$/.test(
            record.event ?? "",
          )
        )
          process.stderr.write(
            `${JSON.stringify({ service, event: record.event })}\n`,
          );
      } catch {
        /* Never forward raw output. */
      }
    }
  }
  process.exitCode = 1;
} finally {
  for (const name of Object.values(names)) {
    if (!name.startsWith(`${prefix}-`)) {
      process.exitCode = 1;
      continue;
    }
    await docker(["rm", "--force", name], true);
  }
  await docker(["network", "rm", network], true);
}

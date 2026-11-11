import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registry } from "@ruwen/core";
import { PostgresFS } from "@ruwen/db";
import { expect, it, vi } from "vitest";
import { demoArchive } from "../../../scripts/lib/demo-archive.ts";
import { fixture } from "../../worker/test/helpers.ts";
import { handleApi } from "../src/server/api.ts";
import { createWebAuth } from "../src/server/auth.ts";
import type { WebServices } from "../src/server/services.ts";
import { loginFixture } from "./auth-fixture.ts";

it("production demo creation imports a prebuilt read-only archive without writing into its source tree or accepting a model task", async () => {
  const p = await fixture(),
    root = await mkdtemp(path.join(tmpdir(), "ruwen-bundled-demo-"));
  const directory = path.join(root, "fixtures"),
    archive = path.join(directory, "demo-project.zip");
  await mkdir(directory);
  await writeFile(archive, await demoArchive());
  await chmod(archive, 0o444);
  await chmod(directory, 0o555);
  const environment = {
    baseURL: "https://localhost:3000",
    secret: "bundled-demo-test-secret-".repeat(3),
    workspaceRoot: root,
    preview: true,
  };
  const services: WebServices = {
    worker: p.service,
    environment,
    auth: createWebAuth(p.service.db, environment),
    ipProofSecret: "test",
    adminEmails: [],
  };
  try {
    const login = await loginFixture(services, `${p.fs.ownerId}@test.invalid`);
    vi.stubEnv("RUWEN_BUNDLED_DEMO", "1");
    const csrf = "a".repeat(64);
    const response = await handleApi(
      new Request(`${environment.baseURL}/api/projects`, {
        method: "POST",
        headers: {
          origin: environment.baseURL,
          cookie: `__Host-ruwen.csrf=${csrf}; ${login.cookie}`,
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ title: "只读归档", mode: "demo" }),
      }),
      services,
    );
    expect(response.status).toBe(201);
    const result = (await response.json()) as { id: string };
    const fs = new PostgresFS(p.service.db, result.id, p.fs.ownerId);
    expect(await fs.sha256(registry.REGISTRY)).toBe(
      await p.fs.sha256(registry.REGISTRY),
    );
    expect(
      (
        await p.service.db.pool.query(
          "SELECT count(*)::int n FROM pipeline_runs WHERE project_id=$1",
          [result.id],
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(await fs.exists("chapters/0001.md")).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    await p.service.stop();
    await chmod(directory, 0o755);
    await chmod(archive, 0o644);
    const resolved = path.resolve(root);
    if (
      path.dirname(resolved) === path.resolve(tmpdir()) &&
      path.basename(resolved).startsWith("ruwen-bundled-demo-")
    )
      await rm(resolved, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
  }
}, 30000);

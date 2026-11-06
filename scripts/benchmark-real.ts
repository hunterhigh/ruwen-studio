import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRealRuntime,
  ROLE_IDS,
  ROLES,
  type RoleResult,
} from "../packages/agents/src/index.ts";
import { LocalDirFS } from "../packages/core/src/index.ts";
import { startChapter } from "../packages/pipeline/src/index.ts";

async function main() {
  const repo = fileURLToPath(new URL("../", import.meta.url));
  const env = path.join(repo, ".env");
  if (existsSync(env)) process.loadEnvFile(env);
  if (process.env.REAL_MODEL !== "1")
    throw new Error(
      "P3真实验证尚未启用：请在本项目.env设置REAL_MODEL=1和ANTHROPIC_API_KEY。",
    );
  const runtime = createRealRuntime();
  for (const id of ROLE_IDS) runtime.resolve(ROLES[id]);
  const directory = path.join(repo, ".local", "p3", randomUUID());
  await mkdir(directory, { recursive: true });
  const source = new LocalDirFS(path.join(repo, "fixtures/demo-project"));
  const rows: {
    sample: number;
    role: string;
    model: string;
    tokens: number;
    costUsd: number;
    durationMs: number;
    promptSha256: string;
  }[] = [];
  const samples: {
    sample: number;
    root: string;
    runId: string;
    status: string;
    costUsd: number;
    error?: string;
  }[] = [];
  const control = new AbortController();
  const interrupt = () => control.abort();
  process.once("SIGINT", interrupt);
  try {
    for (let sample = 1; sample <= 3; sample++) {
      if (control.signal.aborted) break;
      const fs = new LocalDirFS(path.join(directory, `sample-${sample}`));
      await fs.transaction(async (tx) => {
        for (const p of await source.list())
          await tx.write(p, await source.read(p));
      });
      const requests: { role: string; context: unknown }[] = [];
      const run = await startChapter(
        fs,
        { chapter: 1 },
        {
          projectKey: "demo-ruwen",
          runtime,
          signal: control.signal,
          onRequest: (context, role) => {
            requests.push({ role, context });
          },
          onProgress: (run) =>
            console.log(
              `sample=${sample} ${run.status} cost=$${run.costTotal.toFixed(6)}`,
            ),
        },
      );
      await writeFile(
        path.join(fs.root, "provider-requests.json"),
        JSON.stringify(requests, null, 2),
      );
      samples.push({
        sample,
        root: fs.root,
        runId: run.id,
        status: run.status,
        costUsd: run.costTotal,
        ...(run.error ? { error: run.error } : {}),
      });
      for (const [role, ref] of Object.entries(run.roles)) {
        const result = JSON.parse(await fs.readText(ref.path)) as RoleResult;
        rows.push({
          sample,
          role,
          model: result.model,
          tokens: result.usage.reduce(
            (sum, usage) => sum + usage.totalTokens,
            0,
          ),
          costUsd: result.costTotal,
          durationMs: result.durationMs,
          promptSha256: result.promptSha256,
        });
      }
      const costs = samples.map((s) => s.costUsd).sort((a, b) => a - b);
      await writeFile(
        path.join(directory, "summary.json"),
        JSON.stringify(
          {
            mode: "real",
            coverage:
              "candidate stages only; no automatic candidate or memory approvals",
            samples,
            roles: rows,
            averageAttemptCostUsd:
              costs.reduce((a, b) => a + b, 0) / costs.length,
            p90AttemptCostUsd: costs[Math.ceil(costs.length * 0.9) - 1],
            p90Method:
              "nearest rank; with 3 samples p90 is max, not a stable pricing estimate",
          },
          null,
          2,
        ),
      );
      if (["FAILED", "FAILED_PRECONDITION", "CANCELLED"].includes(run.status))
        break;
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
  console.log(`实际调用记录：${directory}`);
  console.log(
    "候选稿仍需人工阅读和批准；使用chapter resume继续。记忆岗位及其费用只在批准候选稿后产生。",
  );
  if (
    samples.length !== 3 ||
    samples.some((s) => s.status !== "AWAITING_CANDIDATE_APPROVAL")
  )
    process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "P3验证失败");
  process.exitCode = 1;
});

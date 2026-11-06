import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createFauxRuntime, createRealRuntime } from "@ruwen/agents";
import { LocalDirFS } from "@ruwen/core";
import {
  approveCandidate,
  approveMemory,
  type ChapterRun,
  cancelRun,
  loadRun,
  type PipelineContext,
  returnCandidate,
  startChapter,
} from "@ruwen/pipeline";

async function main(): Promise<void> {
  const env = fileURLToPath(new URL("../../../.env", import.meta.url));
  if (existsSync(env)) process.loadEnvFile(env);
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      project: { type: "string" },
      chapter: { type: "string" },
      run: { type: "string" },
      faux: { type: "boolean", default: false },
    },
  });
  const action = positionals[1];
  if (
    positionals[0] !== "chapter" ||
    !["run", "resume", "status", "cancel"].includes(action ?? "") ||
    !values.project
  )
    throw new Error(
      "用法：chapter run --project <目录> --chapter <编号> [--faux]；chapter resume|status|cancel --project <目录> --run <ID> [--faux]",
    );
  const fs = new LocalDirFS(
    path.resolve(process.env.INIT_CWD ?? process.cwd(), values.project),
  );
  const manifest: unknown = JSON.parse(
    await fs.readText("authoring-ruwen-v5/manifests/author-manifest.json"),
  );
  if (
    !manifest ||
    typeof manifest !== "object" ||
    !("context_scope" in manifest) ||
    !manifest.context_scope ||
    typeof manifest.context_scope !== "object" ||
    !("project" in manifest.context_scope) ||
    typeof manifest.context_scope.project !== "string"
  )
    throw new Error("项目manifest缺少project作用域");
  const control = new AbortController();
  const onInterrupt = () => control.abort();
  process.once("SIGINT", onInterrupt);
  const ctx: PipelineContext = {
    projectKey: manifest.context_scope.project,
    runtime: values.faux ? createFauxRuntime() : createRealRuntime(),
    signal: control.signal,
    onProgress: (run) =>
      console.log(
        `[${run.status}] ${run.id}  已报告成本 $${run.costTotal.toFixed(6)}`,
      ),
  };
  const reader = createInterface({ input: process.stdin, terminal: false });
  const answers = reader[Symbol.asyncIterator]();
  const ask = async (prompt: string) => {
    console.log(prompt);
    const answer = await answers.next();
    return answer.done ? "" : answer.value.trim();
  };
  try {
    let run: ChapterRun;
    if (action === "run") {
      if (!values.chapter) throw new Error("缺少 --chapter");
      run = await startChapter(fs, { chapter: values.chapter }, ctx);
    } else {
      if (!values.run) throw new Error("缺少 --run");
      run = await loadRun(fs, values.run);
      if (run.projectKey !== ctx.projectKey) throw new Error("项目不匹配");
      if (action === "status") {
        console.log(JSON.stringify(run, null, 2));
        return;
      }
      if (action === "cancel") {
        await cancelRun(fs, run.id, ctx);
        return;
      }
    }
    if (run.status === "AWAITING_CANDIDATE_APPROVAL") {
      const candidate = run.paths.candidate;
      if (!candidate) throw new Error("缺少候选稿");
      console.log(
        `\n候选稿：${fs.displayPath(candidate)}\nsha256：${run.candidateSha256}\n\n${await fs.readText(candidate)}`,
      );
      for (const id of [
        "qinggan-duzhe",
        "wenxue-bianji",
        "qingjie-heyanyuan",
        "xianshi-heyanyuan",
      ] as const) {
        const role = run.roles[id];
        if (role) {
          const result = JSON.parse(await fs.readText(role.path));
          console.log(`\n${id}\n${JSON.stringify(result.output, null, 2)}`);
        }
      }
      if (run.targetBeforeSha256)
        console.log(
          `将替换正式章节 ${run.target}；旧sha256：${run.targetBeforeSha256}\n${await fs.readText(run.target)}`,
        );
      const answer = await ask(
        "输入 APPROVE 批准以上候选稿；RETURN 退回；CANCEL 放弃；回车或EOF保留待批准状态：",
      );
      if (answer === "APPROVE") {
        if (!run.candidateSha256) throw new Error("缺少候选稿哈希");
        run = await approveCandidate(
          fs,
          run.id,
          {
            confirmed: true,
            expectedSha256: run.candidateSha256,
            ...(run.targetBeforeSha256
              ? { expectedTargetSha256: run.targetBeforeSha256 }
              : {}),
          },
          ctx,
        );
      } else if (answer === "RETURN") {
        run = await returnCandidate(fs, run.id, "用户在终端退回候选稿", ctx);
      } else if (answer === "CANCEL") {
        run = await cancelRun(fs, run.id, ctx);
      }
    }
    if (run.status === "AWAITING_MEMORY_APPROVAL") {
      const preview = run.paths.memory_preview;
      if (!preview) throw new Error("缺少记忆预览");
      const result = JSON.parse(await fs.readText(preview));
      console.log(`\n记忆预览sha256：${run.memoryPreviewSha256}`);
      for (const patch of result.patches)
        console.log(
          `\n文件：${patch.path}\n修改前：\n${await fs.readText(patch.path)}\n修改后：\n${patch.new_content}`,
        );
      const answer = await ask(
        "输入 APPROVE 批准以上记忆变更；CANCEL 放弃本次运行；回车或EOF保留待批准状态：",
      );
      if (answer === "APPROVE") {
        if (!run.memoryPreviewSha256) throw new Error("缺少预览哈希");
        run = await approveMemory(
          fs,
          run.id,
          { confirmed: true, expectedSha256: run.memoryPreviewSha256 },
          ctx,
        );
      } else if (answer === "CANCEL") run = await cancelRun(fs, run.id, ctx);
    }
    console.log(
      `\n运行结果：${run.status}\n记录：${fs.displayPath(`authoring-ruwen-v5/reports/runs/${run.id}/run.json`)}${run.error ? `\n原因：${run.error}` : ""}`,
    );
    if (["FAILED", "FAILED_PRECONDITION"].includes(run.status))
      process.exitCode = 1;
  } finally {
    reader.close();
    process.removeListener("SIGINT", onInterrupt);
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "运行失败");
  process.exitCode = 1;
});

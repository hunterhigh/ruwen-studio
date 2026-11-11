import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ModelCredentialError } from "../packages/agents/src/runtime/model-credentials.ts";
import { prepareRealPreviewEnvironment } from "./lib/real-preview-environment.ts";
import { startRealPreviewProcesses } from "./lib/real-preview-processes.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
try {
  const { values } = parseArgs({
    options: { faux: { type: "boolean", default: false } },
  });
  const env = prepareRealPreviewEnvironment(root, values.faux);
  await startRealPreviewProcesses(root, env, (line) =>
    process.stdout.write(`${line}\n`),
  );
} catch (error) {
  process.stderr.write(
    error instanceof ModelCredentialError
      ? "凭据检查失败：请先在当前 PowerShell 窗口中临时设置 DEEPSEEK_API_KEY；模型 key 不得存入任何配置文件。\n"
      : "本机预览启动失败；不会打印凭据或原始服务异常。\n",
  );
  process.exitCode = 1;
}

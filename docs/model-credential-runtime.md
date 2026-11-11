# 模型凭据：进程环境来源

人类的真实key只留在其PowerShell进程环境，不写文件、不提供给Codex；Codex不代跑live。共享代码位于 `packages/agents/src/runtime/model-credentials.ts`，从 `@ruwen/agents` 导出：

- `assertModelCredentialFiles(root?)`：启动前检查工作区/CWD的运行用 `.env*`、Node显式 `--env-file` 和模型路由JSON；发现非空模型key或key文件间接引用即拒绝。示例文件不加载，空占位不作为凭据。
- `loadRuntimeEnvironment({root?,file?,skipFile?})`：检查始终执行，skip不能绕过；仅装载非模型设置，保留父进程优先级。
- `processModelKey(provider)`：仅从当前进程环境读取；不查dotenv、SDK凭据文件或用户目录。支持ANTHROPIC_API_KEY、OPENAI_API_KEY、DEEPSEEK_API_KEY。
- `createRealRuntime()`：模型请求强制注入环境key，拒绝apiKey/env/auth-header覆盖与未受保护的请求入口；SDK事件、跨delta文本与原始异常在进入岗位/录制前脱敏。内部thinking仍保留给协议，公开边界仍用既有剥离。

A线程接入：web/server和真实预览启动脚本在 `deploymentCanary()`、Next初始化/`app.prepare()`及任何dotenv加载之前调用共享检查；不要调用 `process.loadEnvFile`。Next的应用目录与工作区根目录不同，必须同时调用 `assertModelCredentialFiles(workspaceRoot)` 和 `assertModelCredentialFiles(path.join(workspaceRoot, "apps/web"))`，覆盖Next会自动读取的应用目录`.env*`，再用 `loadRuntimeEnvironment({root: workspaceRoot,...})` 装载允许的非模型设置。不要仅检查工作区根目录便启动Next。模型走共享 `createApplicationRuntime`，不要自建带文件key的SDK客户端。`MODEL_PROFILE=deepseek`复用独立DeepSeek路由，默认仍为Anthropic。

CLI live不再加载.env，所需变量均由人类当前进程设置。报告/日志不得序列化process.env、SDK客户端或请求options；如需额外诊断，仅使用已有元数据日志，或 `redactModelValue(value, secrets)`。文件检查限定于运行配置与显式凭据源，不扫描用户磁盘；任何其他文件均不作为模型key来源。未开启真实收费、未执行真实请求。

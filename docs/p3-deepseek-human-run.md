# 人类在 PowerShell 运行 DeepSeek P3 验证

若当前PowerShell找不到`pnpm`，使用Node自带的`corepack.cmd pnpm`替代下文命令中的`pnpm`；它读取仓库固定的pnpm版本。可先设置`$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'`避免首次下载询问。2026-11-12首次运行已留下失败证据`smoke-01`；下一轮改用`.local/p3-deepseek/smoke-02`等新目录，原目录不可重复record。修复合并后仍须由人类验证完整流程，faux通过不等于真实通过。

前提：你已在**当前自己的 PowerShell 窗口**临时设置 `DEEPSEEK_API_KEY`。不要把值贴给 Codex，不写 .env、脚本、配置、终端录制或其他文件。以下命令均不含 key 值。此目录已安装 Node/pnpm、依赖和 vendor 子模块；工具创建独立临时数据库，无需设置 DATABASE_URL，不修改演示源项目。

先进入本次准备好的仓库 worktree。窗口中的环境变量只会由随后的人类命令继承；Codex 不执行这些 live 命令。

```powershell
cd C:\Users\admin\.codex\worktrees\ruwen-backend-parallel
"已设置，长度：" + $env:DEEPSEEK_API_KEY.Length
```

长度应大于0；只显示长度，不运行 `Get-ChildItem Env:` 或输出 key。若为0，请在自己的窗口按原有方式重新临时设置，仍不要保存文件或发送值。

设置这次运行所需的其他环境变量，用密码学随机数生成 canary，仅留在当前进程环境中：

```powershell
$env:MODEL_MODE = 'record'
$env:MODEL_PROFILE = 'deepseek'
$env:REAL_MODEL = '1'
$canaryBytes = New-Object byte[] 32
$canaryRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$canaryRng.GetBytes($canaryBytes)
$canaryRng.Dispose()
$env:RUWEN_CANARY = 'RUWEN_' + [BitConverter]::ToString($canaryBytes).Replace('-', '')
```

先 ping。仅纯文本与结构化工具各一次，输出上限分别为128/1024 token，单次超时120秒，不隐藏重试，总预算不超过目录上界0.02美元。退出码0且两项OK后再继续。ping使用Flash，覆盖思考关闭的纯文本与思考开启的工具；完整冒烟才验证Pro及各岗位表现。

```powershell
pnpm p3:ping --profile deepseek --output .local/p3-deepseek/ping
if ($LASTEXITCODE -ne 0) { throw 'ping失败：先停止并通知Codex读取报告，不运行冒烟。' }
```

可选先重新核对离线预算（不调用任何模型）：

```powershell
pnpm p3:smoke --plan --profile deepseek --max-usd 1.2
```

本次固定演示轨迹11个请求预计上界为 **$0.8595032321**，在$1.2下可完成，provider calls=0。完整输出见 [预算报告](reports/p3-deepseek-plan.md)。真实回复、工具回合及纠正会改变后续输入，每次发送前仍重新预算；不保证真实轨迹跑完，不自动提高上限。以安装pi-ai费率为基准，不能替代服务商账户账单限额。

ping成功后，运行一次冒烟并自动record。请保留$1.2上限：

```powershell
pnpm p3:smoke --live --profile deepseek --max-usd 1.2 --output .local/p3-deepseek/smoke-01
```

输出目录必须是新目录；不要覆盖旧录制。流程为构思对话→通讯门→故事构思预览→章节编译→一章写作及检查→记忆预览。工具只在独立临时项目中代表演示用户消费必要批准；下游文件预览与记忆不自动提交。CLI将工具内部点数账本固定在faux沙箱，**不会因此切换真实模型传输**；真实上游由`--live`录制，按美元预算单独计量，不开启生产收费。

预计ping需数秒到数分钟；完整流程可能数分钟至数十分钟，受网络、思考长度、正文及工具回合影响。岗位超时沿用配置的10分钟，发生失败、超时、截断或预算不足即记录并停止，不能把一次失败重试当作免费操作。若费用未知，保留预留并停止，不自动再请求。不要因等待较久重复启动同一命令。

报告位置：

- `.local/p3-deepseek/ping/ping-report.json`：两次检查、实际token/缓存/费用/耗时、成功与否。
- `.local/p3-deepseek/smoke-01/report-record.json`：每岗token、缓存、费用、耗时、重试、截断、阶段和安全处理后的失败原文。
- `.local/p3-deepseek/smoke-01/candidate-record.md`：完整候选稿；若作者未完成，查看JSON中的`candidateDrafts`，不会把失败尝试晋升成候选稿。
- 同目录`.local/model-recordings/`：私有录制；不含key、thinking或系统提示词原文，协调员使用来源引用格式。

运行结束或失败后，只需告诉Codex“已运行完毕”和上述输出目录；不要发送环境变量、请求头、key或canary值。Codex读取报告分析，不修改提示词。401/403需你自行确认环境key和账号权限；429/网络错误先停下保留报告；文件凭据错误应从文件移除凭据后仅在当前进程设置。截断/工具格式失败/预算不足也先交报告，不自行放宽审批或提高预算。若启动阶段失败还没有报告，仅提供不含凭据的错误信息。

如需重放，同一个PowerShell保持相同profile和canary、不要改提示词/配置，再运行下列离线命令；不需要新provider请求，报告费用重用原录制，不代表再次收费：

```powershell
pnpm p3:smoke --mode replay --profile deepseek --max-usd 1.2 --output .local/p3-deepseek/smoke-01
```

结束后可关闭窗口清除临时环境。录制不保存canary；关闭窗口后新生成canary会改变请求哈希，旧录制不能保证重放。一次冒烟不代表P3验收通过，报告`p3GatePassed`保持false。

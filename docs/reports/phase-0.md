# P0 阶段报告：仓库初始化与技术验证

日期：2026-11-06。状态：**验收项通过，等待人工确认；尚未进入 P1。**

## 交付结果

1. 独立本地 Git 仓库，main 分支；pnpm workspace 的 5 个 packages 与 3 个 apps 已建骨架。没有创建远程仓库、部署或开通付费服务。
2. Node ≥22.19、TypeScript strict（附 noUncheckedIndexedAccess / exactOptionalPropertyTypes）、Vitest、Biome、锁文件、换行策略、环境变量样例已接入。
3. 只读上游 submodule 固定 `v5.0.0` / `9835470fa07b216c85602915a38063b0d7c937b5`；内部 `06-网文体裁编辑器` 未初始化；vendor 工作树无源码差异。
4. `@earendil-works/pi-agent-core`、`pi-ai`、`pi-schema` 均精确安装 1.5.0，npm 可用，无需 fallback 构建。实际包源码仓库为 [earendil-works/pi](https://github.com/earendil-works/pi)。
5. `packages/agents/spike/` 提供 faux 技术验证，`config/models.json` 的暂定路由及 `config/model-catalog.json` 的静态目录快照已生成并检查。
6. [上游清单](../upstream-inventory.md) 覆盖 12 个业务脚本的参数、读写路径、输出与退出码，12 个岗位全部职责和禁止事项，以及 `test_ruwen_v5.py` 的全部 36 个测试。清单覆盖数量有自动检查。

packages/core、pipeline、db、billing 和应用目前是骨架，不能宣称领域核心、岗位编排、网页或计费已实现。没有调用真实模型，P0 模型 API 支出为零。

## 真实 pi API 与计划示意的差异

依据：安装包 `dist/agent.d.ts`、`dist/types.d.ts`、`dist/providers/faux.d.ts`、`pi-schema/dist/validator.d.ts` 和对应 JS 实现，而非旧 pi-mono 文档。

| 主题 | 1.5.0 的实际行为 | 产品实现含义 / P0 证据 |
|---|---|---|
| 创建 Agent | AgentOptions 必须传 streamFn；model/systemPrompt/tools/messages 在 initialState | createModels 注册 faux.provider，注入 models.streamSimple；未用 pi-coding-agent |
| 工具 schema | pi-schema 用 obj/str 等 builder；execute(toolCallId, params, signal, onUpdate) | 编译时可推导 params；提交结果需含 content、details，可另带 structuredContent |
| 参数校验 | runtime 默认转换类型；数字 42 可转成文本 "42"，hook 拿到 args 为转换后值，但 toolCall.arguments 保留原值 | 不能将自动转换当严格 schema 通过；spike 验证 compile(schema).check(rawArgs) 可在副作用前阻断，P2 必须接入 |
| 提交结束 | terminate 在工具**结果**中；同批所有 finalized 工具都 terminate 才提前结束 | 单一提交不再请求模型的测试通过；另有反例证明提交不阻止同批其他工具。P2 要平台提交状态与终止保护 |
| 写入拦截 | beforeToolCall 在参数校验后执行，返回 `{block:true,reason,terminate?}`；阻断结果为 isError | 真实执行函数未被调用，错误结果含 approval_required；这只是拦截能力，尚未实现业务批准系统 |
| 回合上限 | 没有 AgentOptions.maxTurns；finishTurn 返回 action:end/continue | spike 用回合计数+finishTurn 在第二回合结束；P2 的 RoleSpec.maxTurns 由包装层落实 |
| 上下文 | 系统提示词与工具声明进入 transcript 的 system 消息；prepareRequest 每次请求（含第一次）前运行 | 不可只检查 user 字段来证明隔离，需截获完整 transcript；两个新 Agent 历史隔离测试通过 |
| 流式/用量 | message_update.assistantMessageEvent 提供 text_delta；message_end 的 assistant 消息带最终 usage | 拼接 delta 与正文一致；仅在最终 assistant message 采集一次 usage，避免增量重复统计 |
| faux 成本 | faux 估算 token，usage.cost 固定为零，即使模型有价格 | 测试明确断言零费用；另以 calculateCost 验证配置价格计算。不得把 faux 结果用于 P3 定价 |
| 取消 | agent.abort()，等待 prompt / waitForIdle 完成；末条消息 stopReason=aborted | 在首个 delta 取消，流与 pendingToolCalls 收敛；AbortSignal/岗位超时的业务接线在 P2 |
| 模型目录 | 使用 provider.getModels / createModels.getModel 和 getSupportedThinkingLevels | 两个直接 API provider 目录已保存；默认 Opus 4.6 / Sonnet 4.6 / Haiku 4.5 的 ID 和等级存在。未测试 API 权限、供应商可用性或文学质量 |

## 验证结果

环境：Windows；Node 24.14.1；pnpm 11.25.0；Python 3.11.9；TypeScript 5.9.3；Vitest 4.0.18；Biome 2.4.5。

| 检查 | 结果 |
|---|---|
| pnpm install（9 个 workspace 项目，包含根） | 成功；依赖固定，安装脚本按 allowBuilds 显式禁用 |
| pnpm lint | 通过 |
| pnpm typecheck | 通过 |
| pnpm test | 3 个测试文件、15 个 Vitest 用例全部通过；其中一个用例运行原始 36 个 Python 测试并断言整体通过 |
| pi API spike | 10/10：提交结束、拦截写入、无效 schema、usage/delta、默认转换、严格拒绝转换、abort、有限回合、混批 terminate、prepareRequest/新上下文 |
| 模型目录检查 | 3/3（每层一个） |
| 上游基线与清单覆盖 | 2/2；上游内部 36/36 |
| vendor 工作树 / 内部子模块 | 无源码差异 / 私有子模块未初始化 |

第一次上游基线有 2 failures + 12 errors，均被模板路由批准哈希不匹配阻塞。调查确认 Windows `core.autocrlf=true` 改变 checkout 字节。改用 `git archive` 导出固定提交原始字节后原测试 36/36 通过；没有修改上游代码、断言或哈希要求。该处理和 pi 差异见 [ADR-001](../decisions/ADR-001-p0-api-and-byte-baseline.md)。

## 后续应解决的明确事项

- P1 差分需要控制时钟和临时根目录，并明确 Python 在各平台上的文本换行行为。包预算是 Unicode 码点，超预算直接拒绝，不能自动截断。
- 上游批准 reserve/commit/rollback 是库接口，不是 CLI 子命令；差分测试需合适的隔离 harness。单独 `python -I x.py` 不能保证上游 sibling imports 可用。
- P2 接线前解决章节情境编译员的交接路由：上游 creative_brief 的接收白名单不含该岗位；不得悄悄扩宽白名单。协调员持久会话须在每轮新 Agent 中选择性重建，禁止原话与转译委托同时下发。
- P3 才验证真实模型成本、文学产出和路由；当前模型 ID 只是可替换起点。价格系数保持未设置。

这些尚未实施的部分在 [OPEN_QUESTIONS.md](../OPEN_QUESTIONS.md) 明确登记，不作为 P0 已完成能力。

## 人工验收停点

依据本仓库 [AGENTS.md](../../AGENTS.md) 的“P0、P3、P5 结束后停下，写阶段报告，等待人类确认”，以及 [PLAN.md 第12节](../PLAN.md)，本次在 P0 停止。确认后下一步为 P1：ProjectFS/LocalDirFS、Python→TS 核心移植、36 场景对应与差分验证；当前不进入该阶段。

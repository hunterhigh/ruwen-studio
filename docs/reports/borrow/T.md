# 块 T · 岗位输入记录预检

## 做了什么

- 基于 `main` 的 `0127fe3` 做只读预检。设计依据为用户提供的《如文工作室 · 借鉴设计》v0.2 第 0、3 节及块 T。
- 1. 12 岗的字段白名单及消息构造在 `packages/agents/src/roles/index.ts:265`、`:323`。表现试写另走 `roles/expression-phase.ts:18`。写作六岗的编排输入在 `packages/pipeline/src/index.ts:445–531`、`:575–610`、`:749–765`。构思输入来自 `packages/pipeline/src/ideation/backend.ts:43`、`workflow.ts:294`、`compilation.ts:168` 与 `specialized.ts:239`，由 `apps/worker/src/ideation-runner.ts:206` 装配，旧派发入口在 `apps/worker/src/service.ts:933`。所有岗位都经 `packages/agents/src/run-role.ts:323–324`，协调员重载经同一构造器（`:452–477`），实际模型请求边界在 `:438–447`。
- 2. `packages/core/src/packet/index.ts:262–369` 持有实际渲染的小节内容、来源和尾部截取点，可以同源记录装入项、字数和截断。现有 `.meta.json` 只记录来源引用和选择方式，`compilePacket` 返回 `{ output, warnings }`（`:381–396`）。可在编译时生成记录并与运行的资料包哈希一起保存，兼容现有资料包格式和 Python 差分校验。
- 3. `packages/agents/src/tools/index.ts:43–75` 的 `readAuthorizedResource` 校验注册表、岗位权限与哈希。工具 `read_resource` 在 `:108–114`，`load_diagnostic` 在 `:134–154`。可在实际工具成功回传处捕获记录，区分工具读取和构造初始消息时的预装读取。
- 4. `packages/db/src/schema.ts:146–173` 的 `role_runs` 有 `id, run_id, role_id, status, input_sha256, model, prompt_sha256, result, transcript, usage, cost_usd, usage_unknown, cache_read_tokens, cache_write_tokens, started_at, finished_at`，尚无 `input_manifest`。`apps/web/src/server/api.ts:297–304` 的 `runDetail` 首先校验归属，`:350–354` 查询 `roles[]`，字段为 `role_id, status, model, usage, cost_usd, usage_unknown, started_at, finished_at`。
- 5. `packages/agents/test/isolation.test.ts:127` 捕获完整模型请求，检查作者和读者看不到被隔离的哨兵。其 `:161` 检查全新上下文和原话／委托隔离，`:181` 检查注册表读权限及项目范围。`apps/worker/test/api-prompt-privacy.test.ts:261` 已覆盖详情与 SSE 的拦截验证。
- 6. 改版块 3 的 PR #47 仍开放。`main` 只有块 2 的全局外框，按借鉴设计第 0 节第 5 条，块 T 的界面需等待改版块 3。
- 实现涉及 `packages/agents` 的消息、上游规则计数和工具结果，`packages/core` 的资料包，`packages/pipeline` 的章节接入，`apps/worker` 的岗位记录，`packages/db` 的迁移 `0204` 及 `apps/web/src/server/api.ts` 的所有者响应。资料包保留原始字节和上游格式，工作进程从 `PACKET_COMPILED` 检查点取回逐项记录。哈希代表实际纳入消息的文本，记录包括送达模型的成功工具结果。
- 人类确认字段限制适用于 `roles[].inputManifest`。该字段只含材料元数据和规则计数，旧运行返回 null。保留详情的归属校验及整个响应的金丝雀回归测试，兼容原调用方。[ADR-018](../../decisions/ADR-018-role-input-manifest-response.md)

## 测试结果

- 12 岗 faux 快照与实际请求一致性检查通过，覆盖按需读资料和诊断、隔离哨兵、作者资料包哈希及读者尾部截断。运行详情验证数据库写入、旧运行 null、归属和金丝雀约束。本地 `pnpm lint` 与 `pnpm typecheck` 通过，`pnpm test --maxWorkers=1` 通过 85 个文件、749 项，`pnpm test:e2e` 通过 32 项，两项现有改版的可选截图归档按配置跳过。
- 写作六岗示例（字数）包括小说作者资料包 569／8000、情感读者上一章尾部 600（截断）、文学编辑读者反应 148 和按需诊断 157、情节核验员锁定顺序 15、现实核验员硬设定规则 39、记忆维护员批准正文 77 和按需资料 106。
- 构思六岗示例（字数）包括创意协调员原话 14 和会话消息 55、项目治理员委托 32、外部知识顾问委托资料索引 25、表现设计师世界总表 116、故事构思师委托 32、章节情境编译员当前故事弧 72。[12 岗完整快照](../../../packages/agents/test/__snapshots__/input-manifest.test.ts.snap)

## 未完成与风险

- 审稿桌浮层、页头摘要、旧运行提示与截图列入 OQ-027「岗位输入记录界面（并入改版块 3）」。本块在后端与 API 完成接入。

## 需要人类决定的事

- 预检提出的响应范围已确认，见 ADR-018。

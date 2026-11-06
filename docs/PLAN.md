# 如文工作室（Ruwen Studio）实施计划

> 版本：v0.1（2026-11-06）
> 用途：交给 Codex 作为完整上下文和分阶段执行计划。
> 上游系统：`hunterhigh/ruwen-writing-system` v5.0.0（Codex 插件形态）。
> 目标：把如文写作系统做成可部署、多用户、带付费账户的网页产品。

---

## 0. 给 Codex 的执行规则

1. **按阶段执行**（第 12 节 P0→P7）。每个阶段有交付物和验收标准；验收不通过不得进入下一阶段。
2. **人工闸门**：P0、P3、P5 完成后停下，写一份阶段报告（`docs/reports/phase-N.md`），等待人类确认。
3. **不变量优先**：第 2 节的不变量不得为了让测试通过而削弱。如果发现某条不变量与实现冲突，记入 `docs/OPEN_QUESTIONS.md` 并停下。
4. **上游只读**：`vendor/ruwen/` 是 git submodule，永远不修改。岗位提示词、规则与契约都以上游为准。
5. **遇到歧义**：先读上游相关文件（SKILL.md、`references/`、`shared/`、脚本源码、`test_ruwen_v5.py`）。仍无法确定的，按第 14 节给出的默认值执行，并记入 `docs/OPEN_QUESTIONS.md`。
6. **决策留痕**：偏离本计划的任何技术决定，写成 `docs/decisions/ADR-NNN-*.md`（背景、决定、理由、替代方案）。
7. **小步提交**：一个任务一次提交，提交前 `pnpm lint && pnpm typecheck && pnpm test` 全绿。
8. **密钥**：任何 API key、支付密钥都不得进入仓库。用 `.env.example` 列出变量名。
9. **pi 的 API 以实际安装版本的类型声明为准**。本计划中的代码片段是示意；与 `node_modules/@earendil-works/*/dist/*.d.ts` 或其 README 冲突时，以后者为准。

---

## 1. 背景

### 1.1 上游如文 5.0 是什么

上游是一个 Codex 插件，由三部分组成：

- **两个入口技能**
  - `ruwen-gushi-gousi`（如文·故事构思）：项目初始化、创意沟通、外部知识接入、人物与世界设计、章节情境编译。
  - `ruwen-zhangjie-xiezuo`（如文·章节写作）：隔离写作、阅读、编辑、核验、批准后的记忆维护。
- **12 个岗位文件**（每个约 300 字节），位于 `skills/*/references/roles/`：
  - 构思侧：`chuangyi-xietiaoyuan` 创意协调员、`xiangmu-zhiliyuan` 项目治理员、`waibu-zhishi-guwen` 外部知识顾问、`biaoxian-shejishi` 表现设计师、`gushi-gousishi` 故事构思师、`zhangjie-qingjing-bianyiyuan` 章节情境编译员。
  - 写作侧：`xiaoshuo-zuozhe` 小说作者、`qinggan-duzhe` 情感读者、`wenxue-bianji` 文学编辑、`qingjie-heyanyuan` 情节核验员、`xianshi-heyanyuan` 现实核验员、`jiyi-weihuyuan` 记忆维护员。
  - 另有 `CREATIVE-SOUL.md`（两份，作者核心段落用 `<!-- AUTHOR_CORE_START/END -->` 标记）、`shared/information-contract.md`、`shared/creative-communication-contract.md`、`references/diagnostics/*.md`（4 份诊断）。
- **约 3100 行纯标准库 Python 脚本**（`scripts/`），负责注册表、批准事件、状态机、作者资料包编译、交接校验等确定性逻辑；`test_ruwen_v5.py` 有 36 个测试，当前全部通过。

项目数据是一棵文件树（模板见 `assets/project-template/`）：`项目/ 人物/ 世界/ 故事/ 表现/ 研究/ 校验/ 治理/ chapters/ authoring-ruwen-v5/`。

注意：仓库里的 `projects/东方战国/` 是 **v4.1 旧目录结构**，不是 5.0 格式，不能直接当 5.0 测试夹具。

### 1.2 为什么要改架构

在 Codex 插件里，岗位隔离、读取白名单、字符上限、"批准前不入正典"，有相当一部分靠提示词**请求**模型遵守（例如"每次只读取单个岗位文件""不得让小说作者看到后续岗位的意见"）。

做成产品后，这些都改由代码**保证**：

- 岗位链由确定性编排代码驱动，不由模型决定；
- 每个岗位是一个全新的 `Agent` 实例，只拿到编排代码交给它的输入；
- 岗位没有 bash、没有通用文件系统，只有为它定制的少量工具；
- 批准由网页上的用户操作生成，服务端绑定目标哈希。

因此 SKILL.md 里的路由与自律类文字**不进入**岗位提示词；进入提示词的只有岗位文件、CREATIVE-SOUL（相应部分）、相关共享契约和输出格式说明。

---

## 2. 不可违背的不变量

以下来自上游架构（`03-设计与迁移/如文写作系统5.0-架构.md` 与两份 SKILL.md）。每条都必须有对应的自动化测试，测试 ID 写在括号里。

| # | 不变量 | 测试 |
|---|---|---|
| I1 | 候选稿不是正典。用户明确批准前，不更新章节、连续性、人物、世界、故事或未来状态。 | `inv-candidate-not-canon` |
| I2 | 批准事件绑定目标文件的 sha256；每个事件只能被消费一次（独占创建消费标记）；业务提交失败时回滚标记。 | `inv-approval-once` |
| I3 | 作者资料包总长 ≤ 8000 字符；generation field ≤ 2200；项目声音 ≤ 1200；POV 镜头 ≤ 900；逐字文本 ≤ 600。只能装入 `active`、作用域匹配、哈希未变、`allow_author: true` 的资源。 | `inv-packet-budget` |
| I4 | 小说作者永远看不到：人物全档、世界资料、故事大纲、研究、治理、校验、文学问题账本、后续岗位意见、来源清单。 | `inv-author-isolation` |
| I5 | 情感读者只看正文和最少阅读定位，不看大纲和检查表。 | `inv-reader-isolation` |
| I6 | 每个岗位都在全新上下文中运行，只拿到为它构造的输入；同一岗位不能同时看到用户原话与翻译后的委托。 | `inv-fresh-context` |
| I7 | 任何岗位读取项目资源，都必须经过注册表：资源 `status` 有效，且 `readers` 包含该岗位 ID。（这一条是平台对上游的加强，上游只对作者强制。） | `inv-readers-whitelist` |
| I8 | 研究或表现资源仍为 `candidate` 时，不得装入作者资料包。 | `inv-candidate-resource` |
| I9 | 所有项目资料变更先生成预览；用户批准后，才在同一个事务里写入文件、更新注册表和审计账本。 | `inv-preview-then-commit` |
| I10 | 文学问题账本与治理账本分开；治理侧只能读类别和复发统计。 | `inv-ledger-separation` |
| I11 | 核验失败时返回正确的上游，不在正文中插入解释来完成履约。 | `inv-no-patch-sentences` |
| I12 | 编辑做实质修改前保存作者原稿；事实修正与文学修改分别记录。 | `inv-editor-original` |
| I13 | 租户隔离：任何岗位的工具都只能访问当前 `project_id`；任何 API 都校验项目归属。 | `inv-tenant-isolation` |

---

## 3. 已定的技术决策

| 决策 | 内容 | 理由 |
|---|---|---|
| D1 智能体底座 | `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` + `@earendil-works/pi-schema`，固定在 1.5.0 | 小而干净：工具 + JSON Schema 参数、`terminate` 提前结束、`beforeToolCall` 拦截、`prepareRequest` 每轮注入上下文、事件流、steer/followUp、`usage.cost` 计费；多模型可以按岗位路由。 |
| D2 不用 pi-coding-agent | 产品后端不使用编程智能体，不提供 bash 或通用文件工具 | 不需要每个用户一个沙箱；把提示注入的影响面降到最低。 |
| D3 编排在代码中 | 岗位链和状态机是普通 TS 代码，模型只负责单个岗位的产出 | 隔离和批准门由代码保证。 |
| D4 移植到 TS | Python 脚本移植为 `packages/core`，用差分测试与原 Python 对齐 | 技术栈统一；运行时不依赖 Python。 |
| D5 虚拟文件系统 | 项目仍是"路径 → 字节"的文件树；有 `LocalDirFS` 和 `PostgresFS` 两种实现 | 保留上游的路径约定和哈希语义；可导出为上游插件能直接打开的文件夹。 |
| D6 提示词来源 | 运行时从 `vendor/ruwen` 读取岗位文件，组装后记录 `prompt_sha256` | 上游更新提示词后，产品只需升级 submodule。 |
| D7 测试模型 | 单元测试和 e2e 一律使用 pi-ai 的 `fauxProvider`；真实模型只用于 P3 手动验证和带标签的冒烟测试 | 测试确定、免费。 |
| D8 技术栈 | Node ≥ 22.19、pnpm workspace、TypeScript strict、Next.js（App Router）、Postgres + Drizzle、pg-boss 任务队列、Vitest、Playwright | 单一语言；用 Postgres 做队列，少一个 Redis。 |
| D9 不依赖 pi-durable | 它被标注为实验性；崩溃续跑用 pg-boss + 步骤检查点自己实现 | 稳定性优先；以后可以再评估。 |

---

## 4. 架构与目录

```
ruwen-studio/
├─ AGENTS.md                      # Codex 工作规则（简版，指向本计划）
├─ docs/
│  ├─ PLAN.md                     # 本文件
│  ├─ upstream-inventory.md       # P0 产出：上游脚本与岗位接口清单
│  ├─ OPEN_QUESTIONS.md
│  ├─ decisions/ADR-*.md
│  └─ reports/
├─ vendor/ruwen/                  # git submodule → hunterhigh/ruwen-writing-system（固定 commit，不递归子模块）
├─ packages/
│  ├─ core/                       # 领域核心（Python 移植），纯函数 + ProjectFS
│  │  ├─ src/fs/                  # ProjectFS 接口、LocalDirFS、契约测试套件
│  │  ├─ src/registry/            # resource_registry
│  │  ├─ src/approval/            # approval_record
│  │  ├─ src/ledgers/             # audit_ledger, problem_ledger
│  │  ├─ src/state/               # story_state
│  │  ├─ src/packet/              # compile_author_packet
│  │  ├─ src/handoff/             # handoff_validator
│  │  ├─ src/checks/              # project_readiness, governance_check, closure_audit
│  │  ├─ src/init/                # init_project（模板来自 vendor）
│  │  └─ bin/ruwen-core.ts        # 与 Python argparse 同构的 CLI，供差分测试
│  ├─ agents/                     # 智能体层
│  │  ├─ src/prompts/             # 岗位提示词组装（读 vendor）
│  │  ├─ src/roles/               # 每个岗位的 RoleSpec
│  │  ├─ src/tools/               # 岗位工具（结构化输出工具、受控读取工具）
│  │  ├─ src/run-role.ts
│  │  └─ src/models.ts            # 模型路由
│  ├─ pipeline/                   # 章节流水线与构思流程的状态机（编排）
│  ├─ db/                         # Drizzle schema、迁移、PostgresFS
│  └─ billing/                    # 额度账本、PaymentProvider 接口与适配器
├─ apps/
│  ├─ cli/                        # ruwen-cli：本地对目录运行流水线（P2/P3）
│  ├─ worker/                     # pg-boss 消费者，执行流水线步骤
│  └─ web/                        # Next.js：页面 + API + SSE
├─ fixtures/
│  ├─ demo-project/               # 最小的 5.0 演示项目（P3 创建）
│  └─ golden/                     # 差分测试输出
└─ config/models.json             # 岗位 → 模型映射
```

运行时数据流：

```
浏览器 ──HTTP/SSE──> apps/web ──写入任务──> pg-boss ──> apps/worker
                                                         │
                                       packages/pipeline（状态机）
                                         │                      │
                              packages/agents.runRole     packages/core（确定性逻辑）
                                         │                      │
                                pi-agent-core / pi-ai        ProjectFS (PostgresFS)
```

---

## 5. Python → TS 移植映射

按依赖顺序移植。每个模块导出纯函数，所有文件读写都通过 `ProjectFS`。

| 顺序 | Python 文件 | TS 模块 | 要点 |
|---|---|---|---|
| 1 | 各文件里的 `sha256_file`、`resolve_under`、路径规范化 | `core/src/fs/*` | 哈希对**原始字节**计算；路径必须留在项目根内；`sha256_directory` 的遍历顺序与 Python 一致。 |
| 2 | `resource_registry.py`（513 行） | `registry` | validate / select（作用域匹配与 specificity）/ transition / refresh-hash；闭合审计与试写证据校验；`author_path_allowed`。 |
| 3 | `approval_record.py`（188 行） | `approval` | 5 种 action：`handoff_execute`、`candidate_approve`、`memory_commit`、`resource_activate`、`expression_activate`；reserve → commit / rollback；消费标记位于 `治理/审批/已使用/`。 |
| 4 | `audit_ledger.py`、`problem_ledger.py` | `ledgers` | JSONL 追加写；事件校验。 |
| 5 | `story_state.py`（1051 行） | `state` | init / check / register-projection / record-approved / promote-approved / migrate / reconcile；替换快照；陈旧检测。 |
| 6 | `compile_author_packet.py`（496 行） | `packet` | manifest 精确键校验、预算截断、`FORBIDDEN_ROLE_STEMS`、作者核心段落提取。输出必须与 Python **逐字节一致**。 |
| 7 | `handoff_validator.py`（298 行） | `handoff` | `--creation-check`（与用户原话的重合检查，原话不落盘）与 `--for-execution`。 |
| 8 | `project_readiness.py`、`governance_check.py`、`closure_audit.py` | `checks` | |
| 9 | `init_project.py` | `init` | 从 `vendor/ruwen/.../assets/project-template` 复制，替换 `__PROJECT_ID__`、`__HASH__`。 |
| — | `migrate_v4_1_preview.py` | 暂不移植 | 列入 P7 之后的待办（用于导入东方战国这类旧项目）。 |

**ProjectFS 接口（草案）**

```ts
interface ProjectFS {
  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;           // UTF-8
  write(path: string, data: Uint8Array | string): Promise<void>;
  createExclusive(path: string, data: Uint8Array | string): Promise<void>; // 已存在时抛 AlreadyExists
  exists(path: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;            // 字典序，与 Python 遍历一致
  remove(path: string): Promise<void>;
  sha256(path: string): Promise<string>;
  transaction<T>(fn: (tx: ProjectFS) => Promise<T>): Promise<T>; // 原子提交；LocalDirFS 用临时目录 + rename 模拟
}
```

---

## 6. 智能体层

### 6.1 RoleSpec 与 runRole

```ts
interface RoleSpec<I, O> {
  id: RoleId;                         // 与上游岗位文件名一致，例如 "xiaoshuo-zuozhe"
  promptFiles: string[];              // 相对 vendor/ruwen 的路径，按顺序拼接
  buildUserMessage(input: I): string; // 只用 input 构造，禁止访问其他数据
  tools(ctx: RoleContext): AgentTool<any>[];
  output:                             // 两种产出方式
    | { kind: "text" }                // 小说作者：纯正文
    | { kind: "tool"; toolName: string; schema: JsonSchema }; // 结构化提交，terminate: true
  modelTier: "strong" | "standard" | "cheap";
  maxTurns: number;                   // 防止循环
}

async function runRole<I, O>(spec: RoleSpec<I, O>, input: I, ctx: RoleContext): Promise<RoleResult<O>>;
// RoleResult = { output: O, usage: Usage[], costTotal: number, promptSha256: string, transcript: AgentMessage[] }
```

`runRole` 的实现要求：

- 每次调用都 `new Agent(...)`，不复用实例，不带任何历史消息（I6）。
- 系统提示词 = 组装后的 `promptFiles` 内容 + 输出格式说明（平台生成，简短）。
- 结构化输出：注册一个提交工具，参数使用 `pi-schema` 定义；`execute` 校验通过后返回 `terminate: true`。模型没有调用提交工具就结束、或参数校验失败时，追加一条纠正消息重试 1 次；仍失败则抛 `RoleOutputError`。
- 用 `finishTurn` 和 `maxTurns` 保证有界。
- 订阅事件：`message_update` 转发给 `ctx.onDelta`（供 SSE）；收集每条助手消息的 `usage`（含 `usage.cost`）。
- 支持 `AbortSignal`，并有超时（默认每岗位 10 分钟，可配置）。
- `transcript` 存入数据库，供调试和用户查看；提示词按 sha256 去重存储。

### 6.2 模型路由

`config/models.json` 定义 `tier → { provider, modelId, thinkingLevel }`，并允许按岗位覆盖。默认值：

- `strong`：小说作者、文学编辑、故事构思师、章节情境编译员、表现设计师；
- `standard`：创意协调员、项目治理员、记忆维护员、外部知识顾问；
- `cheap`：情感读者、情节核验员、现实核验员。

P0 时确认 pi-ai 1.5.0 的模型目录里有哪些模型 ID，再填默认值；API key 只来自环境变量。

### 6.3 章节写作岗位：输入、工具、输出

开始实现前，Codex 必须完整阅读每个岗位文件。下表的 schema 是起点；如果与岗位文件的要求不一致，以岗位文件为准并更新 schema。

| 岗位 | 输入（编排代码构造） | 工具 | 输出 |
|---|---|---|---|
| 小说作者 `xiaoshuo-zuozhe` | `core.packet.compile()` 产出的作者资料包全文 | 无 | 纯文本正文，存为 `authoring-ruwen-v5/candidates/` 下的候选稿。禁止规划说明、完成清单、来源解释。 |
| 情感读者 `qinggan-duzhe` | 正文 + 最少阅读定位（章节号、上一章尾部若干字；具体以岗位文件为准） | `submit_reading` | `{ reactions: [{ anchor: string /*正文中的短引文*/, type: "noticed"\|"expected"\|"misread"\|"lost_interest"\|"felt_explained", note: string }] }` |
| 文学编辑 `wenxue-bianji` | 正文 + 读者反应 | `load_diagnostic(name)`：只能从 4 个诊断文件中选一个；每次运行最多调用 2 次 · `submit_edit` | `{ decision: "LOCAL_EDIT"\|"RESTAGE"\|"RETURN_CONSTRUCTION", edited_text?: string, changes: [{ kind: "fact"\|"literary", before: string, after: string, reason: string }], return_reason?: string }`。原稿由编排代码在调用前保存（I12）。 |
| 情节核验员 `qingjie-heyanyuan` | 编辑后正文 + generation field 中"必须发生的可观察事件和用户锁定顺序" | `submit_verdict` | `{ pass: boolean, issues: [{ promise: string, problem: "missing"\|"changed"\|"order", evidence: string }] }` |
| 现实核验员 `xianshi-heyanyuan` | 编辑后正文 + 相关硬设定（`校验/硬设定规则.md` 中经注册表允许的部分） | `submit_verdict` | `{ pass: boolean, issues: [{ category: "identity"\|"time_space"\|"knowledge_source"\|"physics"\|"institution"\|"ability"\|"canon", evidence: string, rule_ref: string }] }` |
| 记忆维护员 `jiyi-weihuyuan` | 用户批准的正文 + 注册表中 `readers` 含此岗位的资料 | `read_resource(id)`（受 I7 约束）· `submit_memory_preview` | `{ new_facts, state_changes, invalidated, scope_changes, next_chapter_state, patches: [{ path, base_sha256, new_content }] }` |

### 6.4 构思岗位

构思面向用户、需要多轮对话，结构如下：

- **创意协调员**是唯一直接和用户对话的岗位（会话型 Agent，消息持久化，每轮通过 `prepareRequest` 从数据库载入）。它可以看到用户原话。
  - 工具：`list_resources()`、`read_resource(id)`（受 I7 约束）、`propose_handoff(kind, payload)`。
  - `propose_handoff` 先用 `core.handoff.creationCheck(payload, rawUserText)` 校验（原话从数据库取，不写进快照），通过后生成一张"创意通讯门"预览卡给用户确认；未通过就把错误返回给模型。
- 用户在网页上确认后，服务端创建 `handoff_execute` 批准事件，再由编排代码把**干净委托**（不含原话，I6）分派给下游岗位：项目治理员、外部知识顾问、表现设计师、故事构思师、章节情境编译员。这些下游岗位作为后台任务运行。
- 下游岗位的产出一律是**预览**（文件补丁 + 说明），走 I9 的预览—批准—提交流程。
- **外部知识顾问**分两步：没有明确问题时先产出学习计划，用户批准后再调查。它有一个 `web_search` 工具，背后是可替换的搜索服务接口（默认实现见第 14 节）。
- **表现设计师**的产出必须通过 `core.checks.closureAudit` 与非正典试写，才能从 `proposed` 进入 `candidate`；`candidate` 到 `active` 需要 `expression_activate` 批准。
- **章节情境编译员**输出 generation field（≤ 2200 字符），由 `core.state.registerProjection` 注册。

`beforeToolCall` 的统一拦截规则：任何会写入项目的工具，只要没有对应的、未消费的批准事件，一律 `block`，并改为生成预览（I9）。

---

## 7. 流水线状态机

### 7.1 章节运行 `chapter_run`

```
REQUESTED
 → READINESS_OK                 core.checks.projectReadiness + core.state.check
 → PACKET_COMPILED              core.packet.compile（失败 → FAILED_PRECONDITION）
 → AUTHOR_DONE                  runRole(xiaoshuo-zuozhe)，候选稿落盘
 → READER_DONE                  runRole(qinggan-duzhe)
 → EDITOR_DONE                  runRole(wenxue-bianji)
     ├ LOCAL_EDIT → 保存编辑稿，继续
     ├ RESTAGE → RETURNED(to: author)，暂停等待用户
     └ RETURN_CONSTRUCTION → RETURNED(to: ideation)，暂停等待用户
 → PLOT_CHECKED                 runRole(qingjie-heyanyuan)；fail → RETURNED(to: zhangjie-qingjing-bianyiyuan)
 → REALITY_CHECKED              runRole(xianshi-heyanyuan)；fail → RETURNED(to: 对应上游)
 → AWAITING_CANDIDATE_APPROVAL  网页展示候选稿、读者反应、编辑记录、核验结论
 → CANDIDATE_APPROVED           用户点批准 → candidate_approve 事件（绑定候选稿 sha256）
                                → core.state.recordApproved → core.state.promoteApproved
 → MEMORY_PREVIEW_READY         runRole(jiyi-weihuyuan)
 → AWAITING_MEMORY_APPROVAL     网页展示逐文件对比
 → MEMORY_COMMITTED             memory_commit 事件 → 单个事务：应用补丁 + 刷新注册表哈希 + 审计账本 + core.state.reconcile
 → DONE
```

规则：

- 每一步都是幂等的检查点，状态写入 `pipeline_steps`。worker 崩溃后从最后完成的步骤继续。
- 默认**不自动循环**：任何 RETURNED 都暂停，由用户决定重跑、修改资料或放弃（控制成本，也尊重用户）。自动重试次数可配置，默认 0。
- 用户可以在任意步骤取消；取消时中止正在运行的 Agent，并按已发生的用量结算。
- 已批准的章节被替换时，必须提供旧哈希并保存替换快照（上游 `--replace-existing --expected-target-sha256` 语义）。

### 7.2 构思会话 `ideation_session`

会话型流程：消息 → 协调员回合 → 可能产生预览卡（创意通讯门、治理预览）→ 用户确认 → 生成批准事件 → 分派下游后台任务 → 下游产出预览 → 用户批准 → 提交。

---

## 8. 数据库（Drizzle，Postgres）

```
users(id, email, name, created_at, locale)
sessions / accounts                       -- 认证库自带
projects(id, owner_id, project_key /*上游 project id*/, title, created_at, upstream_version)
project_files(project_id, path, content bytea, sha256, size, updated_at, PRIMARY KEY(project_id, path))
project_file_history(id, project_id, path, sha256, content bytea, changed_at, cause_event_id)
approval_events(id, project_id, action, target_path, target_sha256, created_by, created_at, consumed_at)
pipeline_runs(id, project_id, kind /*chapter_run|ideation_dispatch*/, chapter, status, created_at, finished_at)
pipeline_steps(run_id, step, status, input_ref, output_ref, error, started_at, finished_at)
role_runs(id, run_id, role_id, model, prompt_sha256, transcript jsonb, usage jsonb, cost_usd numeric, started_at, finished_at)
prompts(sha256, content)                  -- 提示词去重存储
ideation_messages(id, project_id, session_id, role, content jsonb, created_at)
previews(id, project_id, kind, payload jsonb, status /*pending|approved|rejected|stale*/, created_at)
credit_ledger(id, user_id, delta_credits, reason, ref_type, ref_id, created_at)   -- 只追加
credit_reservations(id, user_id, run_id, amount, status, created_at)
subscriptions(user_id, provider, external_id, plan, status, current_period_end)
payment_events(provider, external_event_id UNIQUE, payload jsonb, processed_at)
```

说明：

- 文件、注册表、审计账本、批准事件 JSON **仍然以文件形式存在 `project_files` 里**，保持上游语义和导出兼容。`approval_events` 表只是加速查询的索引，权威数据仍是项目文件。
- `PostgresFS.createExclusive` 依赖主键冲突实现；`transaction` 使用数据库事务。

---

## 9. 网页产品

界面先做简体中文，文案集中管理，方便以后加繁体。

| 页面 | 功能 |
|---|---|
| 登录 / 注册 | 邮箱魔法链接 + Google（默认用 Better Auth；落地前确认其 API） |
| 项目列表 | 新建项目（调用 `core.init`），导入 zip，导出 zip |
| 项目首页 | 就绪清单（`projectReadiness` 的结果，逐项显示缺什么），最近章节，待处理批准 |
| 构思 | 与创意协调员对话（SSE 流式）；预览卡（创意通讯门、治理预览、文件对比）带"批准 / 修改 / 拒绝"；下游任务进度 |
| 章节 | 发起写作；按岗位显示进度和费用；候选稿阅读器；读者反应以批注形式标在正文旁；编辑决定与修改记录；两份核验结论；批准 / 退回 / 放弃 |
| 记忆提交 | 逐文件对比，批准后提交 |
| 项目文件 | 只读浏览器（参考上游 `07-项目阅读器`），显示注册表状态和作用域 |
| 账户与计费 | 余额、用量明细（每次运行、每个岗位）、购买 / 订阅、发票链接 |
| 管理后台 | 用户、成本、失败任务、手动补偿额度 |

API 约定：

- 所有写操作都是服务端动作，校验 `project.owner_id`（I13）。
- 批准操作只能由已登录的项目所有者在网页上触发；服务端重新读取目标文件、计算 sha256、创建批准事件。前端传来的哈希只用于"内容已变化"的提示，不作为依据。
- 流式输出：`GET /api/runs/:id/events`（SSE），事件来自 worker 写入的 Postgres `LISTEN/NOTIFY`，或轮询 `pipeline_steps`。

---

## 10. 计费

- **计量**：每个 `role_run` 的成本 = Σ `usage.cost.total`（pi-ai 按模型价格表计算，单位美元）。
- **额度**：内部用"点数"。`点数 = ceil(成本 × 加价倍数 × 每美元点数)`，两个参数放在配置里。
- **预留与结算**：发起运行前按该类运行的历史 p90 成本预留点数（没有历史数据时用配置的默认值）；余额不足时拒绝发起。每个岗位结束后按实际用量结算；运行结束时释放剩余预留。
- **账本**：`credit_ledger` 只追加，余额 = Σ delta。任何调整都写一条新记录。
- **支付**：定义 `PaymentProvider` 接口（`createCheckout`、`createPortalLink`、`verifyWebhook`、`parseEvent`），实现 `MockProvider`（测试用）和一个真实适配器。webhook 按 `external_event_id` 去重，保证幂等。
- **套餐（默认，可配置）**：注册赠送试用点数；月订阅含固定点数；另可单独购买点数包。
- **自带 API Key（BYOK）**：P7 之后再做。用户自己的 key 加密存储，只收平台费，不扣模型成本。

---

## 11. 部署与运维

- 两个 Docker 镜像：`web`、`worker`；共用托管 Postgres。
- 区域优先东京或新加坡（主要用户在台港和海外华文圈；具体以第 14 节的决定为准）。
- CI（GitHub Actions）：lint、typecheck、单元测试、差分测试（需要 Python 3.11+）、Playwright（faux 模型）。
- 可观测性：Sentry、结构化日志（带 run_id / role_id）、每日成本报表。
- 安全：限流（按用户、按 IP）；密钥只放在环境变量；日志不记录正文全文；定期备份数据库并演练恢复。

---

## 12. 分阶段执行计划

### P0 仓库初始化与技术验证

任务：

1. 创建 pnpm workspace（第 4 节的结构），TS strict，Vitest，ESLint 或 Biome，`.env.example`。
2. 添加 submodule：`git submodule add https://github.com/hunterhigh/ruwen-writing-system vendor/ruwen`，固定 commit。**不要**递归初始化它内部的子模块（`06-网文体裁编辑器` 是私有的，不需要）。
3. 安装并固定 `@earendil-works/pi-ai@1.5.0`、`@earendil-works/pi-agent-core@1.5.0`、`@earendil-works/pi-schema@1.5.0`；确认它们能从 npm 安装。如果不能，记入 OPEN_QUESTIONS，并评估从 `badlogic/pi-mono` 源码构建。
4. 技术验证（`packages/agents/spike/`）：
   - 用 faux provider 跑一个带 `submit_x` 工具（`terminate: true`）的 Agent，断言循环在提交后结束、结构化参数可以拿到；
   - 用 `beforeToolCall` 阻止一个写工具；
   - 采集 `usage`；
   - 用 `abort()` 取消；
   - （可选，带 `REAL_MODEL=1` 标签）对真实模型做一次流式调用。
5. 写 `docs/upstream-inventory.md`：
   - 每个 Python 脚本的命令、参数、读写哪些路径、输出 JSON 的结构、退出码含义；
   - 每个岗位文件的全文要点：输入、输出、禁止事项；
   - 上游 36 个测试分别覆盖什么。

验收：

- `pnpm test` 全绿，技术验证测试通过；
- `upstream-inventory.md` 覆盖全部 12 个脚本、测试文件 `test_ruwen_v5.py` 和 12 个岗位；
- **人工闸门**：提交 `docs/reports/phase-0.md`，包括 pi API 与本计划示意代码的差异。

### P1 领域核心移植（packages/core）

任务：

1. `ProjectFS` 接口、`LocalDirFS`，以及一套可复用的契约测试（P4 的 `PostgresFS` 也要跑同一套）。
2. 按第 5 节顺序移植模块。每个模块配 `bin/ruwen-core.ts` 的同名子命令，参数与 Python 的 argparse 一致。
3. 把 `test_ruwen_v5.py` 的 36 个测试逐一改写为 Vitest，场景一一对应。
4. 差分测试（`packages/core/test/differential/`）：对同一份临时项目副本，分别运行 Python 脚本（`python3 -I vendor/ruwen/.../scripts/x.py`）和 TS CLI，比较退出码、标准输出 JSON（结构相等）和执行后的文件树（逐文件 sha256）。至少覆盖：
   - init → validate；
   - transition 的各合法和非法路径；
   - approval 的 reserve / commit / rollback / 重复消费；
   - packet compile（含超预算、含 candidate 资源、含哈希变化，**输出逐字节一致**）；
   - state 的 init / check / record-approved / promote（含替换已有章节）/ reconcile；
   - handoff 的 creation-check 与 for-execution。
5. 为第 2 节中属于 core 的不变量（I1、I2、I3、I8、I9、I10）写专门测试。

验收：36 个移植测试全部通过；所有差分场景一致；core 运行时不依赖 Python。

### P2 智能体层（packages/agents）与本地 CLI

任务：

1. 提示词组装：`prompts/manifest.ts` 定义"岗位 → 上游文件列表"；作者岗位只取 CREATIVE-SOUL 中 `AUTHOR_CORE` 标记之间的部分（与 `compile_author_packet.load_author_core` 一致）；对组装结果做快照测试，并计算 `prompt_sha256`。
2. 实现 `runRole`（第 6.1 节）和全部 12 个 RoleSpec（第 6.3 / 6.4 节）。
3. 模型路由（第 6.2 节）。
4. `packages/pipeline`：实现 `chapter_run` 状态机（第 7.1 节），这一阶段在 `LocalDirFS` 上运行，暂不接数据库。
5. `apps/cli`：`ruwen-cli chapter run --project <dir> --chapter <n> [--faux]`；交互式批准用终端确认，生成批准事件的方式与网页一致。
6. 测试（全部使用 faux）：
   - 每个岗位：正常输出、未调用提交工具时重试、schema 不合法、超出 maxTurns；
   - I4 / I5 / I6 / I7：截获发送给模型的完整上下文，断言其中不含禁止内容。做法：在测试项目里给大纲、研究等文件放入唯一的哨兵字符串，断言哨兵没有出现在作者和读者的请求里；
   - I11 / I12；
   - 状态机：每条分支都有测试，包括 RETURNED 和取消。

验收：`ruwen-cli chapter run --faux` 在测试项目上跑完全流程，所有产物落在与上游一致的路径；隔离测试全绿。

### P3 真实模型端到端验证

任务：

1. 创建 `fixtures/demo-project`：用 `core.init` 初始化，然后手写一个最小但完整的 5.0 项目（项目章程、主角档案三部分、世界总表、一个核心系统、当前态势、项目声音、POV 镜头、硬设定规则、一个章节情境），注册并批准到能通过就绪检查。内容简短，明确标注为演示用。
2. 用真实模型跑 3 次章节写作，记录每个岗位的 token 数、成本、耗时和输出。
3. 写 `docs/reports/phase-3.md`：成本表（每章平均和 p90）、失败与重试情况、提示词组装后实际发出的系统提示词示例，以及一章完整的候选稿和各岗位输出。

验收：**人工闸门**。由人类阅读候选稿与成本表，决定是否调整模型路由和定价参数后再继续。

### P4 持久化与后台任务

任务：

1. `packages/db`：第 8 节的 schema 与迁移；`PostgresFS` 通过 P1 的契约测试。
2. `apps/worker`：pg-boss 消费 `chapter_run` 和下游构思任务；每一步写检查点；用 `NOTIFY` 推送进度。
3. 崩溃恢复测试：在每个步骤中途杀掉 worker，重启后能续跑，且不重复扣费、不重复消费批准事件。
4. 项目导入导出：zip 格式，目录结构与上游插件完全一致；做"导出 → 导入"往返测试，逐文件 sha256 相等。
5. 测试环境用 Docker Compose 起 Postgres（或 testcontainers）。

验收：两种 FS 都通过契约测试；崩溃恢复测试通过；导入导出往返一致。

### P5 网页应用

任务：

1. 认证、项目归属中间件（I13）。
2. 第 9 节的全部页面（管理后台可以简化）。
3. SSE 流式；预览卡与逐文件对比组件；候选稿阅读器（读者反应标注）。
4. 构思会话（第 6.4 / 7.2 节）完整打通。
5. Playwright e2e（faux 模型，需要 `MODEL_MODE=faux` 开关）：
   - 注册 → 新建项目 → 构思对话 → 确认创意通讯门 → 下游预览 → 批准提交 → 就绪；
   - 编译章节情境 → 发起章节 → 查看候选稿 → 批准 → 记忆预览 → 批准提交；
   - 退回分支；取消；
   - 用户 A 无法访问用户 B 的项目（API 和页面两层都测）。

验收：e2e 全绿；**人工闸门**：部署到预览环境，由人类试用。

### P6 计费

任务：

1. `packages/billing`：账本、预留与结算（第 10 节）；接入流水线（发起前预留，每个岗位结束后结算，结束时释放）。
2. `PaymentProvider` 接口、`MockProvider`，以及真实适配器（具体服务商见第 14 节）。
3. webhook 路由（验签、幂等）；账户页；余额不足时禁止发起；管理后台可以手动调整额度。
4. 测试：账本恒等式（余额 = Σ delta）；并发发起时不超扣；webhook 重放幂等；取消运行时按已用量结算；崩溃恢复时不重复结算。

验收：上述测试全绿；在支付服务商的沙箱里完成一次购买 → 加点 → 消费的完整流程。

### P7 上线准备

任务：

1. Dockerfile ×2、CI、部署配置（平台见第 14 节）、Sentry、限流、备份脚本。
2. 邀请码注册（灰度）；服务条款和隐私政策页面（放占位文本，由人类提供正式内容）。
3. 运维手册 `docs/runbook.md`：部署、回滚、补偿额度、处理卡住的运行、升级上游 submodule 的流程（升级后要重跑快照测试和差分测试）。
4. 部署 staging 环境并跑冒烟测试。

验收：staging 可用；冒烟测试通过；运维手册完整。

### 之后的待办（不在本次范围）

BYOK；迁移 `migrate_v4_1_preview`（导入东方战国这类旧项目）；商业顾问模块（上游 `02-项目商业顾问`）；网文体裁编辑器（上游 `06`，私有）；繁体界面；团队协作。

---

## 13. 测试策略汇总

| 层 | 工具 | 内容 |
|---|---|---|
| core 单元 | Vitest | 36 个移植测试 + 不变量测试 |
| core 差分 | Vitest + Python 3.11 | TS 与上游 Python 行为一致 |
| FS 契约 | Vitest | LocalDirFS 与 PostgresFS 跑同一套 |
| agents | Vitest + faux | 每个岗位的输出、重试、隔离哨兵 |
| pipeline | Vitest + faux | 状态机全部分支、取消、崩溃恢复 |
| billing | Vitest | 账本恒等式、并发、幂等 |
| e2e | Playwright + faux | 第 P5 节的用户流程、租户隔离 |
| 真实模型 | 手动或带标签 | P3 报告；上线前冒烟 |

---

## 14. 待人类决定的问题（Codex 先按默认值实现，并保持可替换）

| # | 问题 | 默认 |
|---|---|---|
| Q1 | 上游仓库的许可证：仓库里没有 LICENSE。产品方必须是作者本人，或已获授权。 | 假定产品方就是作者本人。 |
| Q2 | 收款主体与支付服务商（Lemon Squeezy / Paddle / Polar 等名义商户，或海外公司 + Stripe）。 | 先实现 `MockProvider` 和 Lemon Squeezy 适配器。 |
| Q3 | 目标用户地区。如果面向中国大陆，涉及 ICP 备案、生成式 AI 备案和微信 / 支付宝收款，工作量大幅增加。 | 第一版面向台港和海外华文用户；不做大陆部署。 |
| Q4 | 默认模型和价格倍数。 | P3 根据实测成本给出建议，由人类拍板。 |
| Q5 | 外部知识顾问的搜索服务（Tavily / Exa / Brave，或模型自带的联网搜索）。 | 先做 `SearchProvider` 接口和一个实现；没有配置 key 时这个工具不可用，顾问只基于已有资料工作。 |
| Q6 | 部署平台和区域。 | Fly.io 或 Railway，东京区；托管 Postgres。 |
| Q7 | 情感读者的"最少阅读定位"具体包括什么。 | 章节号 + 上一章批准正文的最后 600 字；以岗位文件为准。 |
| Q8 | 编辑判定为 RESTAGE 时退回给谁。 | 暂停，由用户选择"让作者重写（附编辑理由）"或"退回构思"。 |
| Q9 | 用户内容的数据政策（是否允许用于改进产品）。 | 不用于训练，不与第三方共享，除非用户主动同意；模型调用只走商用 API。 |

---

## 15. 非目标

- 不做通用的 AI 写作助手；只实现如文的岗位链和治理模型。
- 不让模型自由决定流程或岗位顺序。
- 不给任何岗位 bash、代码执行或任意文件访问能力。
- 不承诺提高文学质量。上游明确表示结构校验不能证明文学质量；产品文案同样不得这样宣称。

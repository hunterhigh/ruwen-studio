# 2026-11-09审查修正报告

范围：按A1 → A3 → A2 → A4 → B1 → B2 → B3执行，每项独立提交。vendor/ruwen保持9835470fa07b216c85602915a38063b0d7c937b5（v5.0.0），未修改上游；I1–I13和已有隔离哨兵、Python差分、批准及恢复测试保留。

## 修正与提交

| 项目 | 提交 | 实际变化 | 对应验证 | 留痕 |
|---|---|---|---|---|
| A1 | c610dee | 10岗依序完整载入SKILL、SOUL、两个shared合同、全部非roles/diagnostics参考文件、自身岗位文件；仅统一LF，保留frontmatter及空白。他岗文件排除；作者/读者保持特殊隔离，作者核心按人类要求在系统与资料包各一次。编辑移除brief；记忆只预装批准正文和资源元数据，实际读取哈希绑定补丁。稳定系统前缀、显式缓存及role_runs缓存计数落库。 | 12岗快照；prompt-contract的55项原文完整子串/顺序、可见性、作者/读者排除、双重输入、缓存前缀和记忆未批准输入测试；chapter中“正确哈希但未实际读取”拒绝；worker缓存计数与迁移幂等。提交前270项全绿。 | ADR-003、PLAN §1.2、OQ-016 |
| A3 | e111413 | 正文、批准正文、读者反应等改用带标签原文，保留换行；结构化字段继续JSON；作者消息保持资料包原文，字段白名单不变。 | messages的4项换行/引号/Unicode、标签碰撞、结构化往返及字段隔离测试；原隔离哨兵。提交前274项全绿。 | ADR-003 |
| A2 | dd86abe | 12岗分别设置输出上限与依据；作者64k、编辑32k，包含思考余量。length抛RoleTruncatedError且不重试/不执行截断工具，保留用量。编辑改唯一边界锚点替换，代码应用、单项1600码点、总量默认最多15%；原稿与事实/文学日志分别保存。记忆只返回小节操作，在同一事务核对实际读取/当前哈希后生成整文件预览供批准。 | output-limits的9项faux/目录/旧格式/最小额度测试；text-edits的9项唯一/缺失/逆序/重叠/比例/小节/CRLF测试；worker截断用量唯一落库；chapter双批准与原稿分类记录。提交前293项全绿。 | 新ADR-006、PLAN §6.3 |
| A4 | c1a1cbb | 默认改Opus 5.5/high、Sonnet 5.5/medium、Haiku 5.5/off。三者目录maxTokens均128000、均forceAdaptiveThinking；全部岗位额度与思考模式受支持。 | model-catalog逐路由检查精确ID、thinking、adaptive与各岗位额度；不调用API。提交前293项全绿。 | ADR-006、更新OQ-003 |
| B1 | b750f63 | 编辑提交五字段问题；批准候选稿事务内复用core问题账本，以run.id计任务。至少3次且跨至少2任务标记复发候选，不生成作者禁令。治理仅read_problem_summary读取类别/次数/任务数/候选标记。 | chapter新增批准前后、重复批准/复发门槛、入账失败整体回滚及放弃/退回不入账；isolation新增治理完整请求私有哨兵隔离。提交前297项全绿。 | ADR-006、新OQ-017 |
| B2 | 3d5647c | pg-boss进程内并发默认4，可配置1–4；同项目try advisory lock串行，忙时释放连接并以250ms至30s退避持久重投。队列TTL与实际岗位超时/6岗链/2次输出尝试/余量共用常量推导，默认7320秒；重启更新已有队列。入口支持并发、超时及余量环境配置。 | worker真实Postgres/pg-boss并发测试：A作者挂起时B完成、A第二任务仅重投、无advisory锁等待且费用各记录一次；公式含非整秒和旧队列更新。原强杀/heartbeat恢复全部通过。提交前299项全绿。 | ADR-007、.env.example |
| B3 | 本报告所在提交 | 事务外只读操作在REPEATABLE READ READ ONLY快照内无行锁校验归属后读取；写路径继续FOR UPDATE。没有采用仍会阻塞写锁的FOR SHARE。 | postgres新增长写事务未释放时五种读取完成且读到旧提交字节，提交后看到新版本；原FS契约、租户隔离、事务/历史测试继续运行。提交前300项全绿。 | ADR-007 |

测试文件：`packages/agents/test/{prompt-contract,messages,output-limits,isolation,roles}.test.ts`、`packages/agents/spike/model-catalog.test.ts`、`packages/core/test/text-edits.test.ts`、`packages/pipeline/test/chapter.test.ts`、`apps/worker/test/{service,recovery}.test.ts`、`packages/db/test/postgres.test.ts`。

## OPEN_QUESTIONS变化

- **OQ-016（人类已确认）**：SKILL“记忆维护员先生成变更预览”说明预览是该岗产出，shared明确允许权威资料。只给批准正文和id/path/type/scope/sha256元数据，不预装资源正文；按需读取继续受readers约束。只有本次实际读取且哈希一致的资源可打补丁；未批准候选及其推断不进入输入。没有关闭判断状态变化、失效资料和生成base_sha256所必需的读取工具。
- **OQ-017（新增，未决）**：放弃候选稿的问题是否入账及纳入复发统计，等待人类决定。当前待批、退回、放弃/取消与批准失败均不入账；私有编辑报告保留问题，只有批准成功才计数，不回填历史。
- **OQ-003（更新，P3闸门保留）**：5.5是本次指定的暂定路由，目录匹配不等于真实API可用性、成本或文学质量已验证。最终模型和价格参数仍由P3实测后人类决定。

## 装配后的系统提示词字数与额度

字数按完整系统字符串的Unicode码点计算，包含frontmatter、空白、平台附注和提交格式，不是token数；上游换行统一LF。这里不包含单独的工具schema与用户消息。机器可核对的字数、UTF-8字节数及SHA-256见[counts.json](review-prompt-examples/counts.json)。

| 岗位 | 系统提示词字数 | maxTokens | 暂定路由 / 思考 |
|---|---:|---:|---|
| 创意协调员 chuangyi-xietiaoyuan | 8311 | 8192 | Sonnet 5.5 / medium |
| 项目治理员 xiangmu-zhiliyuan | 8321 | 16384 | Sonnet 5.5 / medium |
| 外部知识顾问 waibu-zhishi-guwen | 8309 | 24576 | Sonnet 5.5 / medium |
| 表现设计师 biaoxian-shejishi | 8351 | 24576 | Opus 5.5 / high |
| 故事构思师 gushi-gousishi | 8309 | 32768 | Opus 5.5 / high |
| 章节情境编译员 zhangjie-qingjing-bianyiyuan | 8344 | 16384 | Opus 5.5 / high |
| 小说作者 xiaoshuo-zuozhe | 511 | 65536 | Opus 5.5 / high |
| 情感读者 qinggan-duzhe | 297 | 8192 | Haiku 5.5 / off |
| 文学编辑 wenxue-bianji | 5455 | 32768 | Opus 5.5 / high |
| 情节核验员 qingjie-heyanyuan | 5020 | 8192 | Haiku 5.5 / off |
| 现实核验员 xianshi-heyanyuan | 5044 | 8192 | Haiku 5.5 / off |
| 记忆维护员 jiyi-weihuyuan | 5207 | 24576 | Sonnet 5.5 / medium |

三份示例均为装配器直接写出的**完整系统提示词**，没有摘录或改写：

- [小说作者，511码点](review-prompt-examples/xiaoshuo-zuozhe.system.txt)：自身岗位文件、既有作者核心及平台附注；作者资料包另走用户消息，核心在两处各一次。
- [情感读者，297码点](review-prompt-examples/qinggan-duzhe.system.txt)：自身岗位文件与平台附注；没有SKILL/SOUL/shared。正文与最少定位另走用户消息。
- [文学编辑，5455码点](review-prompt-examples/wenxue-bianji.system.txt)：所属入口与全部规定源文在前，自身岗位末位，然后是平台附注及锚点/问题格式；没有其他岗位文件或预装诊断。

可在仓库执行`node scripts/report-review-prompts.ts`重新生成字数与示例。缓存使用实际provider usage记录cacheRead/cacheWrite；受供应商缓存条件影响，不保证每次命中。pi-ai自适应思考与输出额度的源码核查记录在ADR-006。

## 最终检查与停点

B3并发定向测试已通过。最终完整`pnpm lint && pnpm typecheck && pnpm test`全部通过：24个测试文件、300项测试，最后运行耗时228.88秒。12岗统计/SHA-256及3份完整示例另经当前运行时装配器逐一比对，全部一致；Git核对vendor无差异。

测试环境为真实本机Postgres与faux provider；原36项Python测试和严格差分仍纳入完整套件。曾因Windows并行fsync导致旧测试初始化超时，A3将测试文件并行数限制为2，未放宽既有断言或超时。本次未调用真实模型、未配置API key、未开始P5。旧整章/整文件格式的在途编辑/记忆结果失败关闭，不能自动套用，需要重新审阅。

交付后停止等待人类确认；下一步由人类配置API key后执行P3真实模型验证。P3完成之前不得开始P5。

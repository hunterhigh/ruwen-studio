# 构思后端第一批：持久化与会话

日期：2026-11-10。依据已合并的契约 v1.1 第 9 节。本批不运行模型，不注册网页路由；协调员执行由第二批接入。计费核心与风控冻结执行按用户新分工归主线程。

实现入口：worker 包导出的 `createIdeationService(db, {modelMode, externalSearch?, beforeRun?})`，返回当前已实现的会话/消息、任务查询/取消及事件服务。参数使用契约的认证 actor；主线程不得从请求正文取 userId。底层 `IdeationSessions` 依赖受归属约束的事务存储，所有业务 SQL 与项目文件使用同一 PostgresFS 事务。

迁移 0200 新建 ideation_sessions、ideation_tasks、ideation_requests、ideation_outbox、ideation_events，增量扩充现有消息表；复合外键绑定项目/会话/任务。历史无会话关联消息保持原样，不通过新会话服务暴露。Drizzle 同步声明；没有改动任何已应用迁移。

会话列表按稳定 bigint 顺序分页（默认 50、最大 100）、可选 open/closed。关闭幂等，只禁止新输入，不取消已有任务。发送先校验全部归属，再验证请求/状态和运行前置门，单事务写入原字节措辞的消息、仅含 ID/修订号的任务请求、持久 outbox、元数据事件和幂等结果。同键同内容重放，同键异内容冲突；关闭/并发发送由项目事务串行裁决。没有原话快照、项目文件或原话事件。

主线程 P6 的 ab275a2 已并入本批基础。worker 适配器直接复用 @ruwen/billing 的 quoteRun/reserveRun/assertRunEnabled/finishReservation；归属之后检查冻结/余额/适用收费门，在同一受理事务绑定预留，已排队取消时释放。bank 由服务端 modelMode 决定，客户端不能选 bank 或费率。beforeRun/onRunAccepted/onTaskTerminal 仅为额外策略，不替代平台默认门。账本、价格、支付和冻结决定全部沿用主线程实现，本线程不修改 packages/billing。

SSE 入口为 `@ruwen/pipeline.ideationSse(service, authenticate, {sessionId, after?, lastEventId?, signal?})`。返回契约 Result<Response>；header 游标优先，排他重放。使用与章节一致的 PostgreSQL 通知/轮询、持久 bigint 游标；构思需要不同事件形状，存独立事件表并共用 ruwen_runs 通知通道。pull 模式有背压，每帧重认证并查归属，权限丢失关闭连接；heartbeat 无游标。模型文字的安全 onDelta 与 reset 生产者由第二批接入，本批只有服务元数据。

越权验收覆盖每个本批服务、跨租户/同租户错项目、非法/未知会话、空列表/过滤/游标、重复关闭分支、事件重连和撤权。网页路由仍由主线程在 API_ROUTES 注册并扩充 requireOwnership；后端服务验收不能替代 HTTP 逐路由 A→B/CSRF 测试。

验证：新增 12 项真实 Postgres + faux 环境测试覆盖原话持久化、幂等冲突、并发单回合、关闭/发送竞态、关闭保留任务、实际三种计费/冻结门及额外策略拒绝、事务失败全回滚、事件顺序与撤权。拒绝无任务、调用或新增消费，既有 signup 赠点不是本次扣费。并入主线程 P6 后 pnpm lint、pnpm typecheck、pnpm test 全绿（55 文件、496 测试）；Linux CI 见本批 PR。23 份提示词来源锁、原生 Node 导入及 24 项强杀恢复已验证。最初发现的 strip-only 构造器语法不兼容已修复；一次 Windows 临时目录 EPERM 在完整重跑中未复现，没有改动核心规则或断言。后续继续补协调员、预览批准、分派与恢复，未在本批宣称第 9 节全部验收完成。构思持久化决定现为 ADR-013，与主线程计费 ADR-012 区分。

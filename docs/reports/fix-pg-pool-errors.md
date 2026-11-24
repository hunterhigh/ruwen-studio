# DB-1 · PostgreSQL 断线处理

## 做了什么

- 预检全仓发现应用唯一直接构造的 `pg.Pool` 位于 `packages/db/src/database.ts`。Worker 的 `service.ts`、Web 的 `services.ts/auth.ts`、`config/health.ts`、`scripts/test-postgres.ts`、运维和预览工具、DB/Worker/Playwright 测试复用该类。Worker 与 `apps/worker/scripts/migrate.ts` 各实例化 pg-boss，其独立池向实例转发错误。原 Worker 已订阅，迁移入口补上订阅。
- 专用会话的借用点是 `Database.transaction`、Worker 的 `service.ts/ideation-runner.ts` advisory lock、`apps/worker/test/service.test.ts` 的 `LISTEN ruwen_runs`、`ideation-fault.ts/ideation-coordinator.test.ts` 的恢复锁探针、`packages/db/test/private-prompts.test.ts` 的临时迁移事务。独立 Client 由 `scripts/dev-postgres.ts` 直接调用 embedded-postgres 的 `getPgClient` 创建，`scripts/lib/isolated-project.ts` 和 `scripts/test-postgres.ts` 通过 `createDatabase` 间接调用，库会安装错误监听。pg-boss 12.38.1 的独立 LISTEN Client 有错误/结束监听、心跳及 30 秒退避上限，当前队列配置使用轮询。
- 章节 SSE（`apps/web/src/server/api.ts`）轮询 `web_run_events`，构思 SSE（`ideation-api.ts`）轮询已存事件，持久游标支持 EventSource 重连。生产没有常驻 `LISTEN ruwen_runs` 会话。新集成测试验证测试订阅终止及显式重订阅，期间通知不会补发。未来新增生产订阅的退避和补读方案已记 OQ-033。
- 失败 CLI 启动独立 `ruwen_tool`。终止来自 `scripts/p3-smoke.ts` 的退出清理调用 `isolatedDatabase.close → EmbeddedPostgres.stop`，Linux 实现给 postmaster 发送 SIGINT。该用例没有 `pg_terminate_backend` 或强制删库。pg-pool 3.14.0 从池数组移除空闲客户端后即完成 `Pool.end()`，客户端的套接字仍在异步结束。如果 SIGINT 抢先，仍在关闭途中的会话会收到 `57P01`，解释了偶发性。CI 堆栈经过 pg-pool 的 `idleListener`。 [失败 CI](https://github.com/hunterhigh/ruwen-studio/actions/runs/45148718044/job/137604944215) · [PostgreSQL 关闭语义](https://www.postgresql.org/docs/18/server-shutdown.html)
- 池与借用会话均安装错误监听，日志仅含固定事件和来源及白名单连接错误码。连接池自动淘汰失败的空闲连接，`Database.close` 等已打开套接字实际结束。ROLLBACK 失败或确认连接故障时丢弃会话，并原样抛出原始错误。
- Worker 发现 advisory lock 会话失联时中止当前执行，避免失锁后继续模型工作。构思取消轮询失败按中断处理。清理路径保证释放会话，P3 证据查询失败时也关闭 Worker 和两类连接池后才停止测试数据库。

## 测试结果

- `pnpm lint`、`pnpm typecheck` 通过。数据库和 Worker 定向回归 14 项通过，覆盖空闲连接被终止后继续查询、原始事务错误、回滚失败、脱敏日志、LISTEN 重新订阅和套接字关闭顺序。
- 本地 P3 复跑有通过轮次，每轮 21 项。Windows 后续轮次间歇出现原生 CLI 50 秒超时，或编辑退回用例 10 秒超时。连续十轮尚待确认。计时探针确认成功轮次中，应用连接池清理先于 PostgreSQL 停止，CLI 完成且模型服务商调用数为 0。
- 本地 `pnpm test` 重试出现 P3、章节流水线和 Python 差分用例超时。`pnpm test:e2e` 建置成功，浏览器用例出现等待候选稿和页面元素的超时。已保存失败证据，完整结果见 PR 验证记录。
- PR 首轮 Linux CI 中 P3 通过，集成测试共 763 项通过、1 项失败。CI 的临时密码 `postgres` 正好出现在固定事件名 `postgres_connection_error` 中，产生脱敏断言误报。改用独立测试标记，日志字段形状仍逐条校验，同时覆盖 TCP 先于 PostgreSQL 错误消息关闭的情况。修正后用同一测试密码在本地复查，5 项断线回归全部通过。 [PR #55](https://github.com/hunterhigh/ruwen-studio/pull/55)

## 未完成与风险

- 数据库完全不可达时，已进行中的事务会失败，并由现有任务恢复语义处理。提交结果依旧以已持久化的状态为准。

## 需要人类决定的事

- 无。

# 计费/冻结接入（主线程，P6）

构思后端仍由并行线程实现，本文件供后续4批服务接入使用，不授权提前注册构思路由。公共前置错误继续使用ideation-service v1.1的INSUFFICIENT_CREDITS/402、ACCOUNT_FROZEN/423、BILLING_DISABLED/403。

- `@ruwen/billing`导出Sql、projectSql(tx)、quoteRun、reserveRun、assertRunEnabled、settleRole、finishReservation。
- 先完成全部归属校验。**在调用者同一个数据库事务里**：quoteRun(tx,actor.userId,bank,kind)取得账户锁并检查风险/付费门/可用余额；创建run；reserveRun(tx,runId,quote)；pg-boss受理。任何失败回滚，不另开事务预留、不创建失败占位。PostgresFS可经projectSql桥接；普通PoolClient满足Sql接口。
- bank由服务端模型模式决定：real/record→live，faux/replay→sandbox；不能从请求体指定。kind为chapter/ideation/memory，预留及费率在服务端配置。
- 实际新模型调用前assertRunEnabled(tx,userId,runId)，继续先检查相关资源归属；不重启已有不确定intent。角色结果和usage写入同事务后，settleRole(tx,userId,runId,roleRunId)按usage.cost结算一次。已有章节worker的cachedRole/saveRole已接这两步，不要在构思中重复扣点。
- 终态finishReservation(tx,userId,runId)；生成后断线、强杀或未知provider结果保留review供核对。runRole的partial.usageUnknown区分本次请求是否已生成但无完整结果；生成前HTTP/拒绝/无内容失败与本地校验失败是已知零费用，cost_usd=0、usage_unknown=false，不按错误类名一律当未知。已报告的完整请求usage仍结算一次，不补跑未知intent。等待人类批准不是终态，不自动释放未来阶段预算。
- 管理员resolveReservation按总实际USD费用追加差额或释放剩余预留，理由对用户可见，账户锁/单次审计/陈旧状态校验与状态变更同事务；不改写原始岗位token/费用证据。
- BillingError含code/status/固定安全message；web层序列化为v1.1风格错误对象，不传播堆栈、SQL或provider原始报错。
- 风险冻结由security_events插入触发。构思侧继续在结果持久化事务记录安全事件；不自行改账户冻结状态。人工解冻经主线程管理API、统一归属/管理员校验、CSRF和追加审计。

本文件描述已实现接点，仍须以后端各批真实服务测试证明其原子性及原话隔离，不能以类型或此文档代替验收。详情见ADR-012和phase-6报告。

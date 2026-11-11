# 构思后端第四批：表现能力与章节情境

日期：2026-11-10。接续 PR #6/#7/#8，完成契约 v1.1 第 9 节剩余专业门。入口 createIdeationService 返回实现全部 18 个 IdeationService 方法的 IdeationServiceBackend。没有修改 apps/web、vendor/ruwen 或 packages/billing。

表现能力顺序遵循上游与 OQ-018：六项实际复核 + core.closureAudit → 用户批准 candidate → 新上下文隔离非正典试写 → 新 activation 预览 → 用户确认阅读与 expression_activate。审计在只读拟文件覆盖层运行，不提前写项目，不合成六项通过。高风险未解决、缺审计或自动扫描失败均不能成为 candidate。试写的 candidate 经本项目注册表/readers/版本/哈希核对，只进入专门试写字段；普通工具仍只读 active，正式作者包不装 candidate。样本与最终接受报告均在激活批准事务才写入项目，没有伪造已读或正典文本。

激活由服务端重新计算快照、资源、闭合审计和试写报告哈希，实际创建/消费 expression_activate，文件/注册表/审计/平台决定原子提交。不同请求 ID 重复批准拒绝，同 ID 重放原凭证。新版本独立 ID/路径重新走全部门，可显式关联本项目同作用域旧版本，禁止覆盖 active 或复用旧证据。

编译不接用户正文/brief，按受权数据库任务构造批准故事/状态/世界/人物资料，每次调用前重查来源与计费/冻结门。待合并记忆、来源变化、跨租户资源或不允许的资料类型拒绝。generation field 用 core.projectionErrors 校验且按码点计数 ≤2200；锁定事件/顺序不能超出服务端已批准来源。用户批准后同事务创建投影与哈希绑定 promises、调用 core.state.registerProjection，并同步默认作者 manifest 的投影/作用域指针，保持既有章节流程可用。来源选择语义见 OQ-021/ADR-014，没有改写项目 POV 标识。

状态、manifest、注册表、candidate 或审计变化会使相关 pending 预览 stale。取消/失败不激活表现、不更新投影；已发生费用仍沿用主线程一次结算。当前进程可证明尚未发出请求时释放未用预留；旧意图恢复不能作此证明，未知费用保持 null/review，不自动重发。试写与编译的响应前后 SIGKILL 均验证不重调、不重复预览/费用。

验收：本批 17 项 faux/Postgres 测试包括完整表现门、缺少/高风险/自动审计拒绝、两个决定事务失败回滚、证据篡改、激活越权与重放、实际 ZIP 导入后逐文件哨兵检查、关闭后的既有编译、实际模型请求/缓存/事件原话隔离、2200/2201 astral 码点、非法锁定、跨项目来源、投影批准后真实资料包编译，以及试写/编译四处原生强杀恢复。pnpm lint、pnpm typecheck、pnpm test 全绿（58 文件、540 测试）；Linux CI 见本批 PR。

交接：主线程可按 #6 → #7 → #8 → 本批顺序接真实服务，逐批注册已实现路由、requireOwnership/CSRF 和 HTTP/浏览器越权测试。平台服务能力 externalSearch 只由实际 SearchProvider 决定；无 key 的真实搜索不可用。所有测试 faux，不配置模型/支付/搜索 key，record 仍在受理前失败关闭，不宣称 P3、浏览器接入或上线已验收。构思四批后按原约定汇报；后续独立任务为 S2-1 红队语料/运行器及 v4.1 预览导入。

服务装配时，HTTP 侧 createIdeationService 的 queue/modelMode/search 必须与消费它的 WorkerService（queue/runtime、WorkerOptions.ideation.search）一致。SearchProvider 由服务端配置并注入两端，不能接受客户端 externalSearch 或 key；未注入时能力为 false，批准外部学习计划返回 SEARCH_UNAVAILABLE。投递只在 start(true) 的实际消费者启动持久 outbox 发布器；start(false) 是生产者/测试模式。HTTP 用 @ruwen/pipeline.ideationSse，认证回调每帧重新确认登录和归属；事件只发送安全 onDelta，不从 getTask/role_runs 的原始响应补字。按 (sessionId,runId,role) 处理 reset，不能跨任务拼流。

# 构思后端第二批：协调员回合

日期：2026-11-10。接续第一批 PR #6；本批提供真实后台协调员执行和通讯门预览，尚不提供批准/分派，后续第三批实现。

worker 的 `createIdeationService` 现返回 `IdeationBackend`，增加 getPreview/listPreviews。WorkerService 注册 kind=ideation，与章节共用 pg-boss 队列、并发额度和项目 advisory lock；独立文件实现 outbox 投递及协调员执行。消息受理记录队列名，投递与删除 outbox 同事务，生产者不依赖提交后的内存回调。第二批新增迁移 0201；预览原始 JSON 字节不可变，服务端 SHA-256 与数据库 CHECK 双重校验，状态独立保存。

协调员每个实际模型请求都通过 Agent.prepareRequest 从受权数据库加载固定 session_revision 边界内的消息；不接收前端历史。保留本次工具结果和纠正消息，只替换会话输入。工具仍只有 list_resources、read_resource、propose_handoff；不修改上游原文和装配源。可正常提问/回复，不强迫每个对话回合产生委托。现有结构化岗位行为保持不变。

propose_handoff 先经现有 runRole 的 creation-check，保存预览前再次以内存中数据库原话校验；sender、四岗接收者、项目作用域、资源 readers/status/批准/哈希均检查，失败不保存任何委托快照。通讯门由干净 payload 构成理解、固定事实、开放部分、示例处理、职责和作用域。独立 payloadSha256 与预览快照哈希分开，不写项目交接文件，不消费任何批准，原话只在协调员消息中。

只有安全层 onDelta 进入构思事件生产者，随后增加原话增量过滤，跨 delta 尾部保持私有；命中原话引用时 reset 当前展示并提示从消息接口阅读完整协调员回复，原话不会进入事件。reset 与 delta 串行落盘，不跨屏障合并。thinking、签名、system 消息均不保存；协调员 role_runs.result.output 和 transcript 刻意留空，只存用量、模型、提示词哈希、资源读取与安全元数据，消息/预览另有权威表。

调用前落 role_runs 意图与输入摘要；成功时消息、预览、用量、唯一费用事实、检查点和会话/任务状态同事务。响应未可靠落盘时被杀，恢复为 INTERRUPTED、成本未知为 null，不重发；完成后重投直接返回，不重复预览/费用。关闭不打断已受理任务。取消保留已用量；模型完成后文件来源哈希变化会拒绝生成预览。模型调用期间不持有数据库事务。

主线程仍负责网页路由/requireOwnership/CSRF、计费与冻结。本批已衔接 main P6：worker 服务默认复用真实计费门，岗位结果、role_cost_events 与 settleRole 同事务，终态调用 finishReservation；未知响应保留 review 预留，已知请求前拒绝释放未用量，重投不重复结算。`WorkerOptions.ideation` 的 beforeRun/onRunAccepted/onTaskTerminal 只添加额外策略，不替代平台门。没有实现收费/冻结业务。实际 runtime.mode 与声明不一致会失败关闭。

录制边界：现有通用 recorder 会保留用户请求，协调员 record 模式因此在受理前返回 PRECONDITION_FAILED，不留下任务或快照。只有不保留协调员原话的专门录制格式验证后才可启用；这不是 P3 已验收的承诺。faux 测试不调用真实模型或搜索，也未配置 key。

新增 10 项 faux/Postgres 验收：每工具轮 DB 重载、三工具白名单、多轮普通对话与关闭后已受理工作收尾、通讯门与不可变快照、预览越权、creation-check 拒绝、原话跨增量与缓存隔离、thinking/金丝雀隔离、有序 reset/固定拒绝、跨工具轮冻结拒绝、预留事务回滚、原生 Node 在响应前后 SIGKILL 恢复。并入 main P6 后 pnpm lint、pnpm typecheck、pnpm test 全绿（56 文件、506 测试）；包含第一批 12 项、既有 48 项岗位测试及 24 项原有强杀恢复。Linux 结果见 PR。

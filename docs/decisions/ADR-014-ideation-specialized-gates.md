# ADR-014：构思专业预览、隔离试写与投影登记

日期：2026-11-10。接续 ADR-011/013、契约 v1.1 与 OQ-018。上游提示词和 I1–I13 不变。

表现提案使用模型实际提交的六项复核，映射到 core.closureAudit 的六个现有类别；不补造 pass。只读文件覆盖层让 core 在未写项目的情况下审计拟写入文本及其实际哈希。没有完整六项、存在未解决项或 core 自动发现风险时，提案仍 proposed。用户批准通过审计的预览后，同事务写资源/审计并执行 proposed→candidate，随后创建独立试写任务；不以 candidate 批准替代 expression_activate。

试写仍由独立表现岗位实例执行，使用同一完整上游系统原文，仅追加可信的非正典输出格式；没有正式作者资料包或章节提交能力。执行阶段只接经注册表核对的本项目 candidate（readers 必须允许表现岗位）、其版本/哈希及作用域。普通资源工具继续只读 active/approved，未向其增加任意 candidate 读取。试写结果先存不可变平台预览；试写样本不入项目、不进正典。激活预览的报告引用是拟写入报告的哈希，不代表用户已阅读。只有 confirmed 与 trialReadConfirmed、真实样本和六项证据都有效时，才同事务写最终 user_accepted=true/canonical=false 报告、创建并消费 expression_activate、转换 active 和保存决定/审计。

已激活资源不覆盖或 refresh-hash。新版本须使用独立 ID/路径重新审计、试写；显式 supersedes 仅能引用本项目、作用域相交且表现岗位可读的 active expression，不接受相同版本。core 在激活事务中处理旧资源 superseded，原批准证据不复用。

编译只从 core.state 已登记的 active_outline/tracked_sources 和可选的本项目批准事实资源构造输入。每个引用仍检查 active/approved/readers/类型/实际哈希，必要权威状态不得陈旧或有待合并记忆。core 已登记的基础来源不重新按当前 POV 做别名筛选；额外客户端引用须 scopeMatches。见 OQ-021。用户不提交原话、brief、锁定文本或 generation field 内容；锁定元数据只能继承同章有效投影的哈希绑定 promises，编译员不能发明锁定项。JSON Schema 的 UTF-16 预算只作词法保护，最终由 core 的 Unicode 码点校验执行 ≤2200 上限。

投影批准同时核对 state、资源、注册表和默认 manifest 原哈希。单事务独占创建投影、promises，调用 core.state.registerProjection，并只同步默认 manifest 的 projection/context_scope 技术指针；其他作者资源选择不改变。这样既有章节流水线可编译已登记的新投影，仍由 core 验证 I3/I4/I8 和资料包上限。失败时文件、state、manifest、审计及决定全部回滚，不使用 memory_commit 伪装投影批准。

全部 18 个契约服务签名由 IdeationServiceBackend 实现，worker 工厂直接返回它。HTTP、CSRF、requireOwnership 路由清单与浏览器接入仍归主线程；服务层越权测试不替代 HTTP 逐路由测试。收费/风控只调用主线程 API，不实现其决策。record 仍失败关闭；没有 P3 真实模型或生产收费验收。

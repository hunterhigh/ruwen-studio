# ADR-011：构思契约与批准边界（仅契约）

日期：2026-11-10。依据：人类要求先提交构思接口契约，合并后才实现；PLAN §6.4/§7.2与上游合同。

本轮只导出类型与IdeationService函数签名，不提供可调用的服务、构思路由或队列实现。消息接口与任务/预览/事件DTO分开；原话只在协调员会话，所有后端公开文本必须实际经过安全与原话隔离检查，类型品牌不替代运行时验证。消息、任务、预览与决定均有明确父项目/会话关联，后续由统一requireOwnership验证。

保留上游creative_brief接收白名单。本构思接口只分派既有四个构思接收岗，编译从已批准资源独立请求；不把编译员塞进creative_brief，也不关闭章节侧已有合法编辑委托。表现能力按实际registry.transition：审计后candidate，非正典试写、用户阅读、expression_activate后active。与计划的差异记录在OQ-005/OQ-018。

批准输入只包含confirmed及陈旧提示哈希，实际哈希、批准ID/路径和上游action都由服务端产生。预览外层快照和handoff独立payload分别校验，避免接收者/作用域逃出批准边界。平台通用文件预览的哈希绑定用户决定不是新的上游action；它必须与文件/注册表/审计同事务存为技术证据，不能替代需要的core批准门。调查复用consultant_brief/handoff_execute，不增加learning_plan_approve或挪用memory_commit。

保留已有事件传输机制。构思事件携带session/run元数据，delta/reset保持根层role/text或role/reason字段；重置只清空当前任务岗位的显示尝试，不改结果与用量。修改/拒绝理由只进入协调员消息，事件只发ID/状态。后续数据库映射、原子提交与隔离哨兵测试仍未实现，不能因类型或网页mock可用而跳过验收。

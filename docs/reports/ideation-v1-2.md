做了什么
- 实现 v1.2 服务工厂、用户数据库选区预览、批准/拒绝、分页/幂等和归属；未改网页/计费核心。
- resource_file 使用实际 resource_activate，文件/注册表/审计/凭证/已发布区间同事务。
- 已发布区间从下游检查来源排除；未选原话仍隔离，协调员本会话允许原话流式回复。
- current_chapter 真实 core 编译校验 600/8000 预算，章节批准后清除槽位；无真实模型调用。
测试结果
- faux 专项：完整协调员→通讯门→下游预览、越权、哈希/幂等、审计故障回滚、模型工具拒绝及章槽位。
- lint/typecheck 及受影响 worker/pipeline/db 160 项通过；全量与浏览器由 PR fast/full CI 验证后合并。
未完成与风险
- 网页路由/统一 requireOwnership 的 NULL task_id 接入由 A 线程负责，指引见 docs/ideation-v1-2-integration.md。
- 当前仍为 faux；P3、生产授权、真实收费和真实模型质量验收未因此通过。
需要人类决定的事
- 无；遵循已确认并修订的契约 v1.2，全绿后自行合并。

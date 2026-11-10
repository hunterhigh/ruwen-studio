# 构思契约交付（contract only）

日期：2026-11-10。分支feat/ideation-contract。第一提交为有序尝试重置；本项第二提交仅为docs/contracts/ideation-service.md、类型签名、类型导出与决策/交接说明。

契约覆盖协调员会话/消息、四岗干净委托与独立编译入口、任务状态、五种预览、批准/拒绝/修改、表现激活、搜索计划门、事件和reset、错误码及全部ID/父子归属表。明确所有批准服务端重算哈希；原话只在协调员会话，不进入下游预览/事件，修改与拒绝意见重新进入协调员消息；不引入上游之外的批准action。

没有服务函数实现、构思API路由、数据库迁移、队列处理器或真实模型调用。主线程只能import type并用假数据适配IdeationService；后续路由必须扩展统一requireOwnership和逐路由A→B=404覆盖。第一项仅接线已有SSE，不改网页组件。OQ-005保留编译接收者边界；OQ-018依据上游记录审计/候选/试写/激活的实际顺序，见ADR-011。

验证：契约初版全量45个文件、446项通过（461.18秒）；同步主线程69e5119后执行`pnpm lint && pnpm typecheck && pnpm test --maxWorkers=1`全绿，47个文件、450项，493.31秒，生产构建与其TypeScript检查通过。最新1f0e28f仅增加安全流测试及注释，合入后lint/typecheck及相关4文件30项目标测试再次通过。迁移使用0102，保留主线程0101管理审计。来源锁23份不变；没有重启或复用主线程预览数据库。

纯类型消费检查验证编译不伪造handoff接收者、批准请求不携带owner/action、编译不接收原话、激活需试读确认、reset原因共用及五种预览联合。原生Node导入契约模块的运行时导出为空。完整后端、哨兵与原子提交验收仍属下一阶段，不能用本次类型检查代替。[最终分支Linux检查](https://github.com/hunterhigh/ruwen-studio/actions/workflows/ci.yml?query=branch%3Afeat%2Fideation-contract)原样执行完整lint/typecheck/test，状态见PR的Checks。

两项同一PR，标题注明contract only，推送后停下；契约经人类合并后再实现构思后端。

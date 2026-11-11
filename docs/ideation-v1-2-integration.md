# 构思 v1.2 后端接入

网页线程从 `apps/worker/src/ideation-service.ts` 导入 `createIdeationServiceV1_2(db,options)`，对应已合并的 `IdeationServiceV1_2` 类型。纯流水线调用方可用 `withIdeationV1_2(existingBackend)`。原 `createIdeationService` 保留 v1.1 预览联合，列表过滤新种类；不要把 verbatim 断言成 file_patch。

新 POST 的路径、CSRF、messageId/目标资源归属守卫按契约 §10 接入；本 PR 不修改 `apps/web` 或注册模型工具。用户请求只传消息 ID、码点区间、目标和幂等键，原文从数据库截取。会话关闭不妨碍选择已有用户消息。预览不创建任务、不调用模型、不产生预留或扣费。

`resource_file` 批准创建并消费实际 `resource_activate`；文件、注册表、平台凭证、审计和已发布区间同事务落盘。区间只保存消息 ID、起止位置、源哈希和批准引用，不复制原话。之后按既有 readers/状态读取普通资料；下游检查来源排除对应区间，剩余原话仍隔离。通讯门 creation-check 仍读取完整原话，委托用资源引用传递资料。

`current_chapter` 不登记为已发布资料。真实 core.packet 在只写内存的预览 FS 中检查预算，批准时在项目事务中再次编译，保持 600/8000 上限和更小合法 manifest 预算。独立 exact-text 文件旁的绑定元数据只保存章、路径、哈希和 active；章节批准事务清除 manifest 槽位并停用该章绑定，后续编译也检查章匹配。

协调员自身 delta 直接使用既有安全层的 onDelta 放行结果，允许本会话原话；系统提示词和 thinking 规则不变。下游继续用未发布原话的增量检查；事件仍按 session/run/role 隔离，预览变更事件只带 ID/状态/哈希。

首次启动须应用 `0203_ideation_verbatim.sql`。verbatim 的 task_id 为 NULL，需把契约 §10.4 的 project/session 关系纳入统一 requireOwnership；不能继续用必需 task 内连接来判断此类预览归属。所有普通岗位预览仍要求真实任务。

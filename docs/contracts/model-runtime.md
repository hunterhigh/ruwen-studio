# 模型运行与本地录制契约

2026-11-09，P5前端/章节线程提供；不属于构思服务接口。

`@ruwen/agents.createApplicationRuntime({mode,workspaceRoot,scenario?,initialDelayMs?,characterDelayMs?})`支持faux/real/record/replay。faux使用packages/agents/fixtures/preview-chapter.md（3960码点、3385个汉字），逐字正文流与首包延迟可配置。所有12岗保留原输入/输出契约，场景列表由FAUX_SCENARIOS导出；normal、anchor_ambiguous、anchor_missing、edit_ratio、length、missing_submit、plot_fail、reality_fail、restage。

章节请求可带`simulation`，仅供faux预览/测试。WorkerOptions保留原runtime零参工厂，新增可选runtimeForRequest(request)；旧调用方不需改动。worker入口按MODEL_MODE和请求simulation选择运行时，构思侧任务实现未更改。用户消息白名单不因simulation扩大。

record只在真实上游被明确授权且REAL_MODEL=1时可运行；测试可显式注入faux上游，不需要key。每个稳定请求哈希存一个完整SDK请求与最终响应（含正文、思考/工具内容、usage、错误等元数据），路径固定在workspaceRoot/.local/model-recordings/，不进Git。凭据、授权头、环境、信号/回调、会话亲和ID不落入请求选项，响应中回显的实际凭据也被替换。重复录制同一请求覆盖该请求的本地夹具。

replay按模型provider/id/api、完整语义消息/工具声明与生成选项稳定哈希查找，不依赖时间戳、随机工具调用ID、供应商响应ID或上一轮usage。资源参数中的id仍参与哈希。faux传输随机API标识会归一化。回放恢复原完整响应和usage，并可逐字重放；无夹具、哈希不符或损坏均失败，不降级调用上游。

RoleResult新增可选runtimeMode，runRole新结果始终填faux/real/record/replay。**replay里的usage/costTotal是已录制请求的费用事实，用于重现界面，不是本次真实API支出；faux/replay不得因此扣取真实消费额度或触发收费。** P6账本接入方应依据runtimeMode区分，缺少该字段的旧结果不能直接假定为新真实调用。

config/models.json逐岗提供maxTokens、timeoutMs、basis；config/runtime.json提供模拟节奏、运行余量与待P3参数。测试覆盖12岗场景、各种失败边界、字符流、离线无上游回放、稳定哈希、密钥回显脱敏及生产收费/邀请保护。

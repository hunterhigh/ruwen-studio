# ADR-015：人类选择 DeepSeek 作为本轮 P3 验证路由

状态：接受（2026-11-11，人类明确选择）。不代表 P3 已通过或授权生产真实收费。

保留 `config/models.json` 的 Anthropic 默认路由，增加显式 `MODEL_PROFILE=deepseek`：strong 使用 `deepseek-v4-pro/high`，standard 使用 `deepseek-flash/high`，cheap 使用 `deepseek-flash/off`。Flash 的目录不支持 medium，故选 high；角色原有 maxTokens/超时及编辑上限共用，不改上游提示词。

核对基准为已安装 pi-ai 1.5.0 静态 provider 和 openai-completions 适配器。两个模型 contextWindow=1,000,000、maxTokens=384,000；Pro 每百万 token 输入/输出/缓存读为 $1.32/$3.96/$0.044，Flash 为 $0.30/$1.20/$0.006，缓存写均为0。快照记录这些目录数据；并非账号可用性或未来价格承诺。两者通过相同工具调用序列化器，结构化岗位只允许已核对工具能力的模型；角色输出上限在解析时校验。

思考模式通过 `thinking.type=enabled/disabled` 与 reasoning_effort 控制。SDK 从 reasoning_content 产生带同名 thinkingSignature 的内部 thinking 块；后续带工具请求按签名还原 reasoning_content，缺失时补空字段。不能在内部工具轮次之前剥离它。公开 transcript、文件、事件和录制仍走既有 thinking 隔离；不新增提示词泄露机制。

选择 profile 而不替换默认值，便于 A 线程网页预览和 CLI 共用、随时切回默认路由。模型 key 仅从人类进程环境取得，共享凭据限制先于 SDK 凭据发现。离线计划和 replay 不解析 key。真实连通性与工具质量由人类 ping/record 冒烟验证，Codex 不执行 live。

主要依据：本机 `@earendil-works/pi-ai/dist/providers/data/deepseek.json`、`dist/api/openai-completions.js`；[DeepSeek 思考与多轮工具回传协议](https://api-docs.deepseek.com/guides/thinking_mode/)、[官方模型 ID](https://api-docs.deepseek.com/quick_start/)（2026-11-11 核对）。协议序列化测试只调用纯转换函数，不调用 provider。

## 核验员使用 standard（2026-11-13 人类决定）

garden-01 的现实核验将可能属于人物误会的推断判为知识来源冲突，导致整条流程停止。人类认为这种误拒的代价高于核验岗位的少量费用，故仅在 DeepSeek profile 中将情节/现实核验员显式覆盖为 standard 同款 `deepseek-flash/high`，不再使用 cheap 的 off。保留情感读者 cheap、Anthropic 默认路由及两岗8192输出上限；思考与最终输出仍共享额度，不额外提高预算或宣称误判已消除。配置测试要求两个覆盖项与 standard 完全一致，防止后续路由漂移；不改上游提示词原文。

做了什么
- 人类P3选择DeepSeek；新增MODEL_PROFILE=deepseek，Pro/high、Flash/high、Flash/off，保留Anthropic默认。
- pi-ai 1.5.0快照记录两模型ID、上下文/输出上限、价格、工具和思考能力；ADR-015记录取舍。
- 共享运行时及离线目录解析共用profile，校验输出上限与结构化岗位工具能力。
测试结果
- 离线核对全部岗位路由、静态目录与纯SDK多轮工具序列化；无provider调用、无真实key。
- 全量以PR fast/full/containers CI为准，既有thinking隔离测试继续运行。
未完成与风险
- 静态目录不能证明人类账号的真实API可用性，须人类ping；价格变动需重新核对。
- ping、人类运行指引和DeepSeek预算计划随后提交；不修改提示词。
需要人类决定的事
- 无，模型选择已获明确授权。

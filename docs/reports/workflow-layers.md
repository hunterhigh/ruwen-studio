# 做了什么
采用 2026-11-11 人类流程；AGENTS 由 B 维护，CI 拆 fast/full，公开分支用 merge 同步，不 force push。
# 测试结果
提交检查及 PR 的 fast/full 结果见 PR；full 包含完整 Vitest 与全部 Playwright。
# 未完成与风险
未配置任何模型/搜索/支付 key；既有安全和不变量断言保留。没有包级脚本时明确限定根测试范围。
# 需要人类决定的事
无；本流程 PR 已明确授权 CI 全绿后自动合并。

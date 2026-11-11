做了什么
- 第1项PR #28已合并；凭据限制#29、路由#30、ping#31、DeepSeek预算#32分别提交，依次CI全绿合并。
- docs/p3-deepseek-human-run.md提供人类PowerShell步骤、两条live命令、随机canary、报告路径和失败处理。
测试结果
- 本机全量75文件680测试、构建、22条浏览器测试通过；新增ping仅faux，双profile计划和录制/replay冒烟12测试通过。
- 离线DeepSeek计划11请求上界$0.8595032321，1.2美元可容纳固定演示，provider calls=0；完整输出见p3-deepseek-plan.md。
- 每个合并以最新main的fast/full/containers CI全绿为准；未读取真实key或执行任何live命令。
未完成与风险
- 真实API连通性、真实输出和P3质量须人类运行后分析；额外工具/纠正可能触发预算停止，不自动调高1.2。
- Dependabot #22为pnpm/action-setup同版本SHA更新，按最新main CI全绿处理；#23 upload-artifact 4→7、#24 Vitest 4→5虽原CI全绿，均为主版本，暂不合并。
- A线程的网页预览自行接入共享环境凭据入口与profile；本批未修改apps/web、计费或上游提示词。
需要人类决定的事
- 代码全部CI绿合并后，人类先ping再冒烟；通知输出目录，Codex只读报告并分析，不修改提示词。

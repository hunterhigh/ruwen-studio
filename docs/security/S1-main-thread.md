# 主线程S1交付记录（2026-11-10）

以SECURITY-DESIGN §5正式编号为准；本轮已同步PR #2/#3。逐项CSP及S1完整对照见[phase-5报告](../reports/phase-5.md)，更严格img-src差异及分工见[ADR-009](../decisions/ADR-009-web-security-boundary.md)。

- S1-1：唯一安全Markdown、禁HTML/图片、HTTPS及三个rel、外链点击确认；CSP/nonce/HSTS/nosniff/Referrer-Policy与设计核对。保留仅self图片策略，不开放data图片；生产无unsafe-inline/unsafe-eval。
- S1-2：现有12条资源路由全部requireOwnership与A→B 404；含SSE/导出。路由覆盖检查在pnpm test/CI中；未来构思的资源参数必须扩展同一测试。
- S1-3：应用及认证POST统一CSRF，Cookie三属性，IP/邮箱限流；15分钟一次性魔法链接、登录会话轮换、全设备登出（含CSRF与他人会话保留测试）。SMTP/Google真实投递/回调配置未验收。
- S1-4：管理页展示现有风险事实、设计配置和追加式访问审计。管理页面/API/邀请码及拒绝访问留痕，邀请码和审计同事务；0101只新增网页审计表并禁止改写/删除，无稿件、提示词或令牌正文。冻结/解冻按钮禁用，状态未知。后端冻结、阈值、复核/解冻、其他风控事件与并发/频率/点数/邮箱执行未接入，继续归并行线程。

第2项提交前lint/typecheck及45文件444项测试通过；生产构建及6项浏览器测试通过。无真实模型、收费或公开部署，未修改vendor、不削弱I1–I13。P5仍未完成；尝试重置事件、构思契约接入与完整构思回归保留后续。

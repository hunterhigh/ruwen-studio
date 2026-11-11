# 主线程 S1 安全对照（2026-11-11）

本表以人类的[SECURITY-DESIGN](SECURITY-DESIGN.md) §3.3.4、§5编号及后续分工为准。主线程已接管S1-4冻结和计费；早期占位界面已替换。P5仍须人类试用，本文不代表P3或公开上线验收。

## §3.3 第4条：CSP与响应头

| 设计要求 | 实际实现 | 验证 |
|---|---|---|
| default-src 'self' | 相同 | security.test逐条断言；production浏览器 |
| img-src 'self' data: | 采用更严格的img-src 'self'；渲染组件不加载任何用户/模型图片 | [ADR-009](../decisions/ADR-009-web-security-boundary.md)；恶意Markdown/ZIP无图片请求 |
| connect-src 'self' | 生产相同；开发仅增加localhost/127.0.0.1的wss热更新 | 生产CSP测试 |
| frame-ancestors 'none' | 相同，并有X-Frame-Options DENY | security.test |
| base-uri 'none' | 相同 | security.test |
| form-action 'self' | 相同 | security.test |
| 脚本nonce | 逐请求随机nonce，传入Next SSR；生产无unsafe-inline/unsafe-eval | production浏览器实际页面脚本运行且无CSP违规 |
| HSTS | max-age=31536000; includeSubDomains | 单元及实际HTTPS响应 |
| X-Content-Type-Options | nosniff | security.test |
| Referrer-Policy | strict-origin-when-cross-origin | security.test及浏览器响应 |

另外保留style/font同源、object-src none、权限与COOP/CORP保护；未为调试UI放宽生产CSP。

## S1-1：唯一安全渲染

SafeMarkdown是唯一Markdown入口，跳过原始HTML并白名单清洗；图片替换为说明文字，只允许绝对HTTPS链接，固定rel="noopener noreferrer nofollow"且外链点击先确认。Biome禁止dangerouslySetInnerHTML，既有渲染入口检查保留。单元与浏览器覆盖脚本、javascript/HTTP链接、图片、恶意导入及取消外链，不执行或外发。新构思消息、预览、差异与流式文本复用同一组件。

## S1-2：归属与事件

51条注册映射中35条接收资源ID，全部经requireOwnership；包含项目、run、checkout、账户、预留，以及19条构思映射。构思核对projectId与sessionId/previewId/taskId/decisionId/messageId的项目关联，错父级也404。管理员跨账户/预留的例外仅由服务端allowlist授权并审计；每日限额为本人专用，管理员也不能代改他人。逐路由A→B 404、匿名401、未知ID、路由声明/实际文件扫描与既有隐私扫描保留；缺新参数夹具或旁路路由使测试失败。

章节SSE和导出沿用统一守卫；构思SSE只用pipeline.ideationSse，按帧/轮询重新认证和检查归属，注销/撤权后关闭。Last-Event-ID优先、游标排他重放；网页按(sessionId,runId,role)重置和去重。真实HTTP测试验证全部19条拒绝不新增任务、模型意图或扣费。

安全正文链路只有provider→runRole/RoleSecurity放行的onDelta→worker事件落盘→已鉴权SSE；没有从原始provider、thinking或transcript补发的路径。既有approved-stream测试通过真实岗位/worker/Postgres/HTTP响应证明实时与回放只含放行前缀，不含被拦尾部、thinking/签名；失败不补写暂扣文本。两类reset浏览器验证更正和拒绝，以及跨会话/任务隔离。

## S1-3：CSRF、会话与登录

应用及认证写请求核对Origin、Fetch Metadata、HttpOnly __Host Cookie对应CSRF头；所有19条构思映射的写操作同样测试。支付webhook独立按原始体验签，不放宽用户写请求。Cookie为HttpOnly/Secure/SameSite=Lax；魔法链接15分钟/一次性、登录轮换会话、全设备撤销。IP/邮箱持久限流，入口覆盖连接IP并HMAC证明，不信任客户端XFF。真实认证SDK与浏览器验证通过；SMTP实际投递、Google真实回调仍待配置。

## S1-4：冻结、费用复核与审计

config/runtime.json保留3.5配置并标注待P3实测。security_events累计风险并触发账户冻结；受理前及实际新模型调用前拒绝冻结账户。管理员明确确认、CSRF及状态检查后解冻，旧事件保留、复核基线后新风险仍可再次冻结。已认证越权/限流计入发起者，匿名邮箱限流不按伪造邮箱冻结受害者。

管理页面/API/邀请码/冻结复核/待核对预留及拒绝访问留痕。审计禁止UPDATE/DELETE/TRUNCATE；邀请码、解冻和费用核对均与对应状态变更同事务。待核对预留按实际总费用结算或释放剩余预留，必填理由，用户可见结果与说明；已知生成前零费用直接释放。管理界面不提供稿件/完整转录读取，不记录正文、提示词或密钥。

冻结→拒绝零任务/零调用/零新增扣费→人工解冻→再次冻结，以及费用核对/幂等/账本恒等式均有集成和浏览器覆盖。剩余3.5控制已补：协调员每会话滚动小时60轮（同事务拒绝，幂等重放不重复计数）；配置域名黑名单覆盖登录、注册及发信前；账户页可调整每日上限。用户章节并发2也接入账户锁，项目串行维持原状。

每日默认值取有效套餐点数的30%，无套餐使用配置的monthly基准；按UTC入账日统计实际消耗及核对冲正，加上所有未结束预留，live/sandbox分别核算。超额在受理前拒绝，不创建任务或扣费；调用新岗位前再次检查。修改本人限额须CSRF，变更与追加审计同事务，降低限额不改写已发生费用。黑名单为需维护的静态配置，不宣称覆盖所有一次性邮箱。数值均标注待P3实测；真实支付沙箱/模型/红队、生产运维与上线前渗透仍保留闸门。

完整验收结果见[phase-5](../reports/phase-5.md)、[计费修正](../reports/billing-reconciliation-2026-11-11.md)与[构思接入](../reports/ideation-http-integration-2026-11-11.md)。vendor和I1–I13未改，既有提示词防护保持现状。

本轮v1.2新增消息选区接口及目标资源归属，NULL任务预览按项目/会话校验；SafeMarkdown增加只读原文选择，未新增HTML入口。独立开发预览Cookie前缀按端口区分，防止覆盖3000试用会话；默认及生产Cookie属性保持。真实持久化、CSRF、零模型/扣费和SSE均通过，见verbatim-ui-2026-11-11报告。

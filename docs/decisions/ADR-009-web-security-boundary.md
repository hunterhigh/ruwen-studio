# ADR-009：P5网页的认证、渲染与资源边界

日期：2026-11-09。状态：2026-11-10已按人类设计核对；S1-4执行逻辑仍待并行后端，P5未完成验收。

## 决定

- 使用已安装 Better Auth 1.7.18 的 Drizzle 适配器、邮箱魔法链接与可选 Google OAuth。认证表单独新增，保留 P4 既有表；新增迁移使用 0100 避免并行后端的编号冲突。注册钩子在服务端检查邀请码授权，不能通过直调认证端点绕过。
- Cookie 统一 HttpOnly、Secure、SameSite=Lax；本机预览也使用 HTTPS。所有应用写请求验证 Origin、Fetch Metadata 和 HTTP-only Cookie 对应的 CSRF 请求头。认证库的一次性邮件验证及 OAuth 回调使用其一次性 token/state 校验。
- 登录按真实连接 IP 与规范化邮箱分别在 Postgres 中限流。自建 HTTPS 入口覆盖转发头，并通过进程密钥 HMAC 证明连接 IP；缺少证明时使用保守共享桶，不相信任意 X-Forwarded-For。
- 用户/模型内容仅经 SafeMarkdown。禁止 HTML、图片节点；仅允许绝对 HTTPS 链接并添加 noopener noreferrer nofollow。纯文本模式也由同一组件转义输出。Biome 将原始 HTML escape hatch 设为错误。
- API 通过统一路由注册表分派，所有资源参数先经过 requireOwnership；不存在、格式无效、其他租户统一 404。SSE 在建立前以及后续轮询时重新认证并检查归属。导出不例外。测试动态遍历每个资源路由执行 A→B 404，并检查没有绕开注册表的新增 route 文件，纳入现有 pnpm test/CI。
- 响应使用 nonce CSP、禁止框架嵌入、nosniff、no-referrer、HSTS 和受限权限策略。正文 CSS 为同源静态文件，不依赖外部字体或图片。开发服务器的 unsafe-eval 仅用于 Next 开发工具；生产 CSP 不启用。
- worker 将文本增量按配置间隔批量落到专用事件表；SSE 按事件 ID 重放。流中断时可重连，最终候选稿与检查点仍是权威结果。事件不写 stdout；提示词与完整 transcript 不作为 SSE 内容。

## 本机预览

LOCAL_PREVIEW 仅在非生产且 MODEL_MODE 为 faux/replay 时生效。预览邮件写入忽略的 .local/mailbox，读取需要本浏览器 HTTP-only 随机 Cookie；不是公开邮箱接口。它不验证真实邮箱所有权，只用于本机人类试用。生产必须提供 SMTP/Google 配置；不会自动启用本地邮箱、公开注册或收费。TLS 证书仅存 .local，不修改系统信任库。

## 验证与限制

security.test.ts 覆盖逐资源路由跨租户 404、路由测试覆盖、CSRF、Cookie、渲染、CSP、IP/邮箱限流、预览邮箱与收费保护。完整浏览器流程、安全设计第 3.3.4 条和第 5 节的最终映射由 P5 报告补齐。

参考实际安装类型与实现；官方接口说明：[Drizzle](https://better-auth.com/docs/adapters/drizzle)、[魔法链接](https://better-auth.com/docs/plugins/magic-link)、[认证配置](https://better-auth.com/docs/reference/options)。外部 SMTP 投递和 Google 控制台配置尚未经实际账号验证，不能以 faux 测试替代。

## 接入验证补记

Next 16.4.5构建使用Webpack，并将workspace运行包及运行配置保留为原生Node模块，避免打包器改写import.meta资产/迁移路径。服务器不会把岗位提示词或凭据装进客户端包；模型输入和vendor没有改变。HTTP请求日志关闭，避免一次性登录token进入开发请求日志。

手动退回复用worker检查点回调，在项目事务中同步文件、运行表、步骤与通知；仅可退回等待批准的候选稿。逐字faux按累计截止时间调度，补16ms定时器粒度测试，避免Windows把每字符误差累积为整章超时。

## 2026-11-10正式设计核对与S1-4分工

正式S1编号以SECURITY-DESIGN第5节为准。Referrer-Policy对齐strict-origin-when-cross-origin；img-src保留self，不开放设计允许的data:，因为没有需要data图片的产品功能，且用户图片全部在组件层隐藏。开发wss/unsafe-eval仅限本机热更新，生产不启用。链接增加外站确认，魔法链接按配置15分钟一次性，补全设备会话撤销。

本线程只读聚合现有security_events，不做冻结决定；界面显示未知/待后端，冻结与解冻操作禁用。每用户并发、协调员频率、消费比例和试用目标为配置中的设计对照值，标为未执行/待P3。冻结逻辑、风险事件扩充、阈值与复核/解冻后端继续归并行线程。

新增0101网页管理访问审计；页面、数据和邀请码操作记录允许/拒绝及操作者，拒绝覆盖未登录/普通账户和无效CSRF。表采用追加保护；邀请码与审计同事务。管理页不提供稿件/完整转录读取，未实现“填写理由后读稿件”或账户删除等额外功能；未来接入前仍需单独鉴权、审计和保留期设计。

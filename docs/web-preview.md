# 本机网页预览

人类试用请从[一页P5试用指南](p5-trial-guide.md)开始；功能、安全对照、验证结果及未完成项见[phase-5](reports/phase-5.md)。构思现已接真实持久化服务，刷新保留会话和结果；产品中不再使用本地演示适配器。

`pnpm dev`仅监听127.0.0.1，使用本机生成的HTTPS证书。启动前设置独立随机RUWEN_CANARY（指南含PowerShell命令）。预览不读取根.env，固定MODEL_MODE=faux、REAL_MODEL=0、P3_GATE_PASSED=0、REAL_CHARGING_ENABLED=0，并移除子进程的Anthropic key；只启用Mock支付沙箱。

登录填写测试邮箱及RUWEN-PREVIEW，打开“本浏览器的预览邮件”；不验证真实邮箱所有权。生产入口禁用预览邮件，需要配置真实SMTP或Google。默认本机管理员为preview@ruwen.local，可通过ADMIN_EMAILS覆盖。认证随机密钥、数据库、证书、预览邮件及模型录制位于Git忽略的.local；停止后数据保留。

章节faux场景还包括anchor_ambiguous、anchor_missing、edit_ratio、length、missing_submit、plot_fail、reality_fail、restage；退回/失败不会自动重写。FAUX_CHARACTER_DELAY_MS覆盖启动流速，默认值在config/runtime.json；按累计截止时间逐Unicode字符调度，Windows可能呈小批次，不累计每字误差。构思正常faux链可保存通讯门、资料预览和编译结果；其他卡片与错误的可控演示仅在浏览器测试专属HTTP夹具中存在。

账户显示实际分账余额、岗位用量、预留与待核对说明；生成前确定零费用直接释放，生成后结果未知保留待核对。管理员带理由结算/释放并留审计。参数仍待P3实测，Mock仅增加沙箱点，不调用真实支付或模型。

验证：pnpm lint、pnpm typecheck、pnpm test；pnpm test:e2e先生产构建，再检查预览与单独的生产HTTPS入口。首次运行先pnpm exec playwright install chromium。全量单元测试期间避免Git/文件扫描正在事务换出的fixtures/demo-project，Windows可能因目录句柄触发EPERM。开发调试UI的个别样式会被严格CSP拦截；生产CSP由独立浏览器测试核对，未因此开放unsafe-inline。

部署使用pnpm --filter web start（自建HTTPS/nonce入口），配置DATABASE_URL、BETTER_AUTH_SECRET、BETTER_AUTH_URL、RUWEN_WORKSPACE_ROOT、TLS_KEY_FILE和TLS_CERT_FILE。部署与公网运维留在P7；当前只有本机预览，不是公开staging。人类试用后再推进下一步，P3与真实收费仍保留人工闸门。

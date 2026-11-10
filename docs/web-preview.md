# 本机网页预览（P5开发中）

运行`pnpm install`后，先在当前终端设置独立随机RUWEN_CANARY环境变量，再执行`pnpm dev`。PowerShell可使用`$env:RUWEN_CANARY = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`；赋值不会输出内容，不把标记写进文件或.env。保持终端运行，打开`https://localhost:3000`。服务只绑定127.0.0.1。首次使用本地生成证书时，浏览器会显示证书未受信任；只对这个本机地址继续访问，不需要修改系统信任库。

登录页填写任意测试邮箱，邀请码`RUWEN-PREVIEW`，点击发送后打开“本浏览器的预览邮件”。该邮件入口只在本机faux/replay开发模式生效，不验证真实邮箱所有权。生产入口禁用预览邮箱，需要真实SMTP或Google配置。`preview@ruwen.local`在默认本机启动配置中具有管理页面权限；可用ADMIN_EMAILS覆盖。

书架中选择“新建项目”→“演示项目”，进入“章节写作”，使用第1章和normal场景。正文逐步出现，五岗完成后可阅读正文、读者批注、编辑记录和两份核验。勾选明确确认后批准正文，等待记忆预览，再逐文件阅读并另行批准资料变更。两个批准不能合并。已批准章节替换仍校验旧哈希并保留原稿。

场景还包括anchor_ambiguous、anchor_missing、edit_ratio、length、missing_submit、plot_fail、reality_fail、restage；退回/失败不会自动再写。放弃记录和文学问题记录保留。可通过FAUX_CHARACTER_DELAY_MS调整启动时的流速，默认来自config/runtime.json；逐字模拟按累计截止时间调度，Windows定时器粒度会形成小批次，但不会把每字误差累积到整章。

构思页已按ideation-service v1提供本地假数据演示：切换或新建会话、发送消息，阅读右侧通讯门及五类预览；模拟批准/拒绝/修改不会写入项目或扣点数，刷新全部清空。表现候选批准与阅读试写后的激活是两次独立操作。页底可展开流式更正/拒绝及错误提示场景。reset只清空当前任务岗位的尝试，不混合其他会话/任务。延迟可在config/runtime.json.ideationDemo调整。真实构思API尚未注册，仍待并行后端接入。

账户页提供已有记录和模拟用量，不收取真实费用；点数、价格、时限和模型上限仍“待P3实测”。P5尚未完成验收，不进入P6、staging或真实模型阶段。

启动器不加载根.env，固定MODEL_MODE=faux、REAL_MODEL=0、P3_GATE_PASSED=0、REAL_CHARGING_ENABLED=0，并移除传给子进程的Anthropic key。本地数据库、认证随机密钥、TLS证书、预览邮件和模型录制均位于Git忽略的.local目录。停止后项目数据保留；同一目录再次pnpm dev可以继续。

验证命令：`pnpm lint`、`pnpm typecheck`、`pnpm test`；`pnpm test:e2e`先构建生产网页，再验证开发预览和另起的本机生产HTTPS入口。首次运行浏览器测试先执行`pnpm exec playwright install chromium`。测试使用当前本机预览数据库，只创建测试账户和项目，不访问真实模型或支付服务。开发服务器自身的调试UI会有被严格CSP阻止的样式；产品渲染与生产CSP另有浏览器验证，没有因此开启unsafe-inline。

部署入口必须使用`pnpm --filter web start`（自建HTTPS/nonce头入口），配置DATABASE_URL、BETTER_AUTH_SECRET、BETTER_AUTH_URL、RUWEN_WORKSPACE_ROOT、TLS_KEY_FILE和TLS_CERT_FILE。部署、证书托管、反向代理信任与公网运维在P7再做；当前并未部署公开预览。

2026-11-10安全更新：登录链接15分钟过期且一次性；账户页可登出所有设备；外站链接在点击时先确认。管理页显示现有风险分、设计配置对照与访问审计；冻结/解冻服务未接入，按钮禁用，状态不作正常或冻结判断。

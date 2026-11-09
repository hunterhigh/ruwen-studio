# 待P3校准参数与上线保护

2026-11-09。本线程维护config/runtime.json与config/settings.ts；计费后端由feat/backend-parallel实现，按本契约消费配置，避免复制硬编码。

- config/models.json的roles[id]包含maxTokens、timeoutMs、basis；作者/编辑的32k最低输出约束保留。
- config/runtime.json：execution包含进程并发及queueMarginSeconds；faux包含scenario、initialDelayMs、characterDelayMs。worker无显式全局超时覆盖时按config/models.json各岗位timeoutMs执行，队列按各岗最大值保守预算。
- billing包含costMarkup、creditsPerUsd、defaultReservations.chapter/ideation/memory、signupCredits和plans[].credits。它们是保守占位，不是公开价格承诺；本线程未实现账本、支付适配器或webhook。
- calibration.label为“待 P3 实测”，界面展示相关点数/费用换算/额度时必须带该标记；运行参数与套餐同样未校准。
- release包含p3GatePassed=false、realChargingEnabled=false、inviteOnly=true。releasePolicy读取P3_GATE_PASSED、REAL_CHARGING_ENABLED、INVITE_ONLY覆盖：P3未通过时始终强制邀请码；真实收费需要P3通过和收费开关同时为1，缺省关闭。assertRealChargingAllowed供所有真实支付入口服务端调用；不能只隐藏按钮。
- P6只做Mock及服务商沙箱，P3过关前不放开真实收费。通过P3也不自动开启收费或解除邀请码。

模型回放保留usage仅用于界面复现，faux/replay不代表真实付费调用；请同时遵循model-runtime.md的runtimeMode约定。

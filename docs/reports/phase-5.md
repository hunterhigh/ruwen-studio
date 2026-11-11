# P5 网页整体验收与人类试用（2026-11-11）

## 做了什么
- 项目书架/导入导出/资料、章节流式与阅读批注、两次独立批准、账户/沙箱购买、管理冻结/解冻和待核对预留均接入持久化服务。
- 构思18条接口接真实后端：会话/对话/五类预览/决定/任务/编译/SSE；HTTP与worker共用queue/modelMode/search。会话刷新定位、三元组reset与重连去重已接入。

安全自查（详证见[主线程S1记录](../security/S1-main-thread.md)；原文[SECURITY-DESIGN](../security/SECURITY-DESIGN.md)）：
| 要求 | 实际实现与验证 | 结论 |
|---|---|---|
| §3.3.4 | default-src self；img-src self（比self data更严，ADR-009）；connect-src self，开发仅加本机wss；frame-ancestors none/base-uri none/form-action self；逐请求nonce，生产无unsafe-inline/eval；HSTS max-age=31536000/includeSubDomains、nosniff、strict-origin-when-cross-origin | 单元逐条+生产HTTPS浏览器通过 |
| S1-1 | 唯一SafeMarkdown禁HTML/图片、仅HTTPS与三个rel并确认外链；lint禁止原始HTML注入 | 恶意Markdown/ZIP无执行或外发 |
| S1-2 | 33条资源路由统一requireOwnership，18条构思逐项核对嵌套归属；新路由漏测即失败；SSE持续重验认证/归属 | A→B、错父级、导出/SSE与撤权关闭通过 |
| S1-3 | 应用写操作CSRF；Cookie HttpOnly/Secure/SameSite=Lax；登录IP/邮箱限流、15分钟一次性链接、轮换/撤销会话 | 认证与浏览器通过，外部SMTP/Google未实配 |
| S1-4 | 配置标注待P3实测；security_events累计冻结，拒绝新运行；管理员带理由复核/解冻和费用核对，追加审计 | 冻结/拒绝零任务/解冻/审计通过；3.5其余限制见风险 |

## 测试结果
- lint/typecheck通过；本机全量59文件570项通过，合入main后受影响23文件196项通过；修正共享DB统计范围后网页80项通过。生产构建及全部18项浏览器通过（3.6分钟），批准精确状态补强后主链另通过。最终CI见[PR #14](https://github.com/hunterhigh/ruwen-studio/pull/14)，合并条件为最新main上的fast/full全绿。
- 无API拦截的faux主链：新项目→对话→通讯门批准→下游预览批准→编译批准→写章→正文批准→记忆提交；核对实际章节/资料文件。五类少见卡片/错误/可控reset另用测试专属HTTP夹具。
- 首轮18项浏览器发现切换会话后刷新丢失定位，已改用URL保留并验证；既有安全onDelta落盘/SSE、I1–I13与恢复断言未削弱，vendor/提示词未修改。

## 未完成与风险
- P3真实模型质量/成本、外部SMTP/Google/搜索/Lemon沙箱、P7 staging与公开上线均未验收；真实收费关闭，生产仍限邀请码。
- S1-4冻结/审计已执行；3.5协调员频率、一次性邮箱名单、用户自调每日限额等未全部完成，不宣称完整上线安全验收。
- 当前v1.1运行；v1.2契约已合并但运行实现/逐字选择UI待后续。faux剧本重复，不能用于判断文学效果或最终定价。

## 需要人类决定的事
- 本机预览已重启并核对faux/P3关闭；按[一页试用指南](../p5-trial-guide.md)试用。现在停在P5人类闸门，等待体验反馈和后续安排；不开始P7/P3或第四项UI工作。

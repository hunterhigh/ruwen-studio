# 尝试重置事件

日期：2026-11-10。基于已合并PR #3（e4b5d1a），分支feat/ideation-contract。

RoleContext新增onAttemptReset(role,reason)。格式/内容纠正、重合纠正均在下一次provider请求之前通知；创意协调员安全替换在固定拒绝语之前通知。原因只使用三个固定代码，不包含模型输出、错误详情、用户原话或标记。重置同时丢弃旧尝试未发布尾部；保留原有跨消息泄露检测与真实usage。

worker将delta/reset串行保存到同一web_run_events游标，reset是批处理屏障；持久化失败停止后续文字并报告，不容许丢失reset后继续发出新尝试。0102迁移添加event_type/reset_reason，旧行默认delta且加入原因约束。同步主线程69e5119后保留其0101管理审计，重置迁移顺延0102；未改已应用迁移。既有SSE路由只做查询/转发接线，按同一ID重放reset；所有归属校验保留，没有修改网页组件。

SSE reset帧：`event: reset`，`id`与delta共用递增游标，`data: {"role":"xiaoshuo-zuozhe","reason":"format_correction"}`。主线程后续监听此事件，清空该岗位已显示的流式缓冲，再接后续delta；不清除费用、已保存结果或协调员会话消息。

验证：第一项独立提交前执行`pnpm lint && pnpm typecheck && pnpm test --maxWorkers=1`全绿，45个文件、446项，445.70秒；同步69e5119后，最终集成全量47个文件、450项通过，493.31秒。随后1f0e28f仅新增安全流测试/注释，相关4文件30项目标复测通过。Windows只限制文件并发，没有放宽断言或超时。新增faux测试覆盖作者candidateProseErrors纠正的delta→reset→delta、协调员泄露的delta→reset→拒绝语、重合纠正时点、跨消息检测不被重置削弱、真实worker落盘顺序、reset写入失败以及真实SSE顺序/游标重连。全部12岗的既有格式纠正测试也校验reset一次。未配置key或调用真实模型；未修改vendor/ruwen。最终Linux检查随合并的契约PR运行。

此项单独提交；随后仅编写构思契约，两项放在同一标题带contract only的PR中。推送后停下，不实现构思后端。

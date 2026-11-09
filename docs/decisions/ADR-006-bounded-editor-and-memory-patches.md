# ADR-006 · 有界编辑与记忆小节补丁

日期：2026-11-09。状态：A2已实施；真实模型效果与额度仍待P3人类闸门。

## 背景

统一8000输出token不足以承载长章与思考。让文学编辑重发整章、记忆维护员重发整份资源会增加截断、无意覆写和审阅负担。I12要求原稿与事实/文学修改分别保留，I9要求资料先预览再批准。

## 决定

config/models.json为12岗分别设置maxTokens和basis：作者65536、编辑/故事构思32768、表现/研究/记忆24576、治理/情境编译16384、协调/读者/核验8192。作者和编辑至少32768。调用前校验不超过已安装模型上限；额度是上界，不预先消耗这些token。

直接核对已安装pi-ai 1.5.0的dist/api/anthropic-messages.js：streamSimple在forceAdaptiveThinking=true分支只传effort，不调用旧模型的adjustMaxTokensForThinking；buildParams把本岗位额度传为max_tokens，思考与正文共享。当前Opus/Sonnet 4.6均为adaptive；后续A4的三款5.5也均为adaptive。作者64k与编辑32k已包含思考余量，不保证文学效果或单章足够，P3检查实际用量再定。当前Haiku 4.5默认off。

stopReason=length立即抛RoleTruncatedError，不纠正、不自动重试，也不执行截断消息内的提交/读取工具。错误携带partial，保留usage/cache计数/费用/转录；worker沿用失败用量落库机制，候选/正典不接受截断输出。

文学编辑LOCAL_EDIT提交edits与problems，不再提供edited_text或自报before/after。每项edits为{anchor_before,anchor_after,replacement,kind,reason}：两个边界原文分别必须在原稿中唯一匹配，边界保留，仅替换其间内容。空before/after分别明确代表篇首/篇尾。所有范围基于同一原稿计算，重叠拒绝，逆序应用；删除与插入码点数较大者是该项修改量。单项最多1600码点，总量最多floor(原稿码点数×maxChangedRatio)，配置默认15%、可下调且不可上调越过15%。重复/找不到/逆序锚点、超单项或总量均拒绝。代码从真实原稿生成before/after日志；原稿在编辑运行之前保存，事实和文学修改分别记录，批准门不变。问题字段为location/category/condition/handling/result，为B1账本接入预留，A2不自动写账。

记忆维护员只提交{path,base_sha256,sections:[{heading,replacement}]}，每资源最多8小节，每小节原/新正文最多4000码点。heading为现有完整ATX Markdown标题且必须唯一；replacement仅为该标题之后、下一同级/上级标题之前的正文，可含下级标题，不得引入同级/上级标题。代码围栏内的标题不当作小节边界。缺失/重复/重叠标题拒绝，不静默创建新小节。保留标题、其他小节和原始CRLF字节；replacement换行匹配目标小节。

岗位提交阶段检查本次读取快照和小节有效性；流水线在生成预览的同一事务内再次核对实际读取哈希、当前哈希及注册表权限，再应用小节操作。core预览中的整份new_content是代码计算、供人类审阅与批准绑定的结果，不是模型输出。批准后的原有原子提交与注册表刷新语义不变。持久缓存中的旧格式失败关闭，不能静默当作无修改。

## 替代与验证

保留整章/整文件输出会继续浪费额度且难以保证改动边界，因此不采用。按行号补丁会受换行和行漂移影响，因此使用唯一原文边界与明确标题。新增text-edits及output-limits测试覆盖确定性应用、Unicode预算、单项/总量/重叠、CRLF保留、截断不执行工具且只调用一次、faux锚点错误与缺失小节；既有pipeline、隔离、批准、强杀恢复测试继续运行。

## A4路由复核（2026-11-09）

默认改为目录中已有的Opus 5.5/high、Sonnet 5.5/medium、Haiku 5.5/off。三者的forceAdaptiveThinking均为true、目录maxTokens均128000；当前各岗上限不变且全部在模型额度内。Opus/Sonnet 5.5支持的思考级别不含off，因此维持high/medium；Haiku 5.5允许off。model-catalog测试逐个验证ID、思考模式、adaptive标志和该路由下的岗位额度。不改变OQ-003的P3人工闸门，不调用真实API。

## B1文学问题账本（2026-11-09）

以下为首次B1实现记录，入账时点和任务定义已由后文OQ-017定案替代。

问题输出沿用A2定义的五字段，location必须引用原稿短原文，字段非空。候选稿批准时从已保存的编辑报告读取problems，在同一项目事务内复用core.ledgers.appendProblem，以run.id为task_id；批准、章节晋升、问题入账与状态检查点共同提交/回滚，重复批准不重复计数。作者原稿和编辑报告保留原定位。core沿用至少三次且跨至少两个任务的复发候选门槛，新增的是流水线接入而非新的统计口径。

只有项目治理员新增read_problem_summary工具，复用core.problemSummary，只返回total、category/count/task_count/recurrence_candidate；不给原始定位、条件、处理、结果和任务ID。通用注册表读取继续排除私有文学问题账本，不把统计转换成作者规则或资料包。放弃稿口径见未决OQ-017，当前不入账。测试覆盖批准前后、重复批准、入账失败整体回滚、跨任务门槛、治理读取无私有哨兵、放弃不入账与不生成作者禁令。

## OQ-017定案：成功提交即入账（2026-11-09）

上游要求“每次问题”入账而没有批准前提，人类据此决定每次成功编辑提交后立即记账。采用core.candidateProblems封装私有账本；原core.ledgers CLI及Python字节差分契约保留。每条观察保留正文定位、类别、条件、处理、结果，增加project_id、chapter、run_id、稳定记录id；status为pending/approved/abandoned/returned。记录id由run_id与问题序号生成，任务键则是JSON编码的[project_id,规范化章节号]，同章重写仍是一个任务。次数包含放弃和退回观察，状态变动不增加次数，复发候选不产生作者禁令。

本地流水线将成功编辑报告与问题记录一同事务保存；数据库worker在成功岗位结果持久化的同一事务内记账，填补“模型已成功提交、进程尚未回到流水线”时强杀/取消的空隙。两处记录入口使用相同幂等id，重放不会重复计数或把终态退回pending。取消发生在成功提交之后仍保留观察；截断、格式失败且未成功提交则不入账。批准、退回和放弃事务同步更新status；批准后的记忆取消不把已批准正文改成放弃。正典变更仍需批准，不把私有观察当正典（I1/I9保持）。

旧B1已入账记录若能通过保存的run.json找到章节，则迁移旧run.id任务键并保留原文、时间与来源；统计读取只在内存解析，不产生写入副作用，下一次记录/状态事务再保存迁移结果。未知旧任务不编造章节，不作为新的独立任务；旧未批准报告不自动回填。治理新统计接口保持原I10白名单，不能读到run_id或私有问题字段。

验证覆盖同章三次不复发、跨两章三次复发、放弃稿计数、批准/退回/取消只改状态、重放不重复和不降级、旧记录任务迁移、编辑入账失败不推进候选批准、治理私有哨兵隔离，以及数据库worker提交后强杀/取消的持久性。提示词和vendor未修改，原平台附注的历史入账描述由本次人类决定和确定性代码覆盖。

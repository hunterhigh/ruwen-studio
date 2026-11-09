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

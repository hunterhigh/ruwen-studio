# 块 0：现有前端页面、操作与数据清单

盘点日期：2026-11-17；代码基线：`6d129b6`（`origin/main`）。只记录现有行为；指令包后续块中的目标不等于当前功能。本文件是后续改版的接口参考，不是新增 API 契约。

## 1. 依据与边界

- 已读 `docs/design/FRONTEND-REDESIGN.md` 全文、HTML 的页面结构/样式/脚本/设计规范、`docs/PLAN.md`（特别是 §2、§9）、`docs/security/SECURITY-DESIGN.md` §3.3–3.4、现有全部 TSX 组件、路由页及 `apps/web/public/studio.css`。
- HTTP 以 `apps/web/src/server/api.ts`、`ideation-api.ts`、`billing-account.ts` 为准；构思类型以 `packages/pipeline/src/ideation/contract.ts`、`service-v1-2.ts`、`verbatim.ts` 为准。仅只读核对这些实现。
- 原型是独立静态参考，没有 API/持久化；不能把其 toast、固定时间、金额、待办数、岗位状态或示例文件当成实际请求结果。原型批注计数等演示瑕疵不移植。
- 当前浏览器安全策略拒绝 `file:` 预览；未绕过限制，未声称已逐页点击原型。原型逐页源码检查已完成，视觉实测仍未完成。
- 两份用户提供的设计文件按原字节入库。`docs/design/biome.json` 仅对 HTML 设计快照关闭 formatter/linter/assist，避免工具改写原稿；应用代码沿用原检查规则。

## 2. 路由与首屏数据

下表 `P` 为项目 UUID，`R` 为运行 UUID。`(studio)` 是 Next.js 路由分组，不出现在 URL。所有项目页先执行 `ownedPage`，有 `?run=R` 时还校验该运行属于同一项目。

| 页面/路由 | 组件与加载 | 当前读取字段/行为 |
| --- | --- | --- |
| `/` | `app/page.tsx` | 服务端跳转 `/projects`，无表单或独立 API |
| `/sign-in` | `SignIn`；服务端 `getServices()` | `preview`、`google` 两个布尔 props；不是从 `/api/settings` 获取；Google 未配置时现为禁用按钮 |
| 全站已登录外壳 | `(studio)/layout.tsx` → `pageUser()` → `Shell` | 服务端认证的 `user.name/email`、`admin`；首屏没有客户端 `/api/session` 调用 |
| `/projects` | `Projects` → `GET /api/projects` | `id,title,created_at,pending`；服务端还返回 `project_key`，现组件未声明使用 |
| `/projects/P` | `ProjectHome` → `GET /api/projects/P`；`GET /api/projects/P/runs` | `project.title`、`readiness.ready/errors`；`state` 已返回但未展示；运行列表现用 `id,chapter,status` |
| `/projects/P/chapters?run=R` | `ChapterStudio`、`RunReader` | 项目运行列表、`GET /api/settings`、`GET /api/runs/R`、运行 SSE；没有独立 memory 页面，预览在正文下方 |
| `/projects/P/ideation?session=S` | `IdeationStudio` | 服务端 props 加构思 HTTP/SSE；客户端从 URL 读 `session`。目前不读取 `preview`/`compile` URL 参数 |
| `/projects/P/files` | `Files` | `GET /api/projects/P/files` 返回路径；额外 GET `?path=治理/资源注册表.json`（URL 编码）；选中文件再读 `?path=…` |
| `/account` | `Account` → `GET /api/account` | 账户、双余额 bank、每日限额、用量/账本/预留/复核/结账/套餐，见 §7 |
| `/admin` | `Admin`、`AdminSecurity` → `GET /api/admin` | 服务端另做管理员认证与审计；`users,projects,failures,release,security` |
| `/admin/reservations` | `AdminReservations` → `GET /api/admin/reservations` | 服务端管理员认证与审计；待核对预留数组 |
| 404/无权限 | `app/not-found.tsx` | 静态说明与 `/projects` 链接，无额外 API |

`app/layout.tsx` 目前只同源加载 `/studio.css`；未加载自托管字体，也没有 copy/ui 基础目录。CSS 现用 `--mist/--navy/--steel/--annotation/--teal/--line/--muted/--ui/--story`，包含旧版响应式断点；本块均未改。

## 3. 公用请求、安全与导航

| 操作/控件 | 当前请求或导航 | 参数、返回值、保护 |
| --- | --- | --- |
| 所有组件的 `request/post` | `components/client.ts` | 首次非 GET 先 `GET /api/csrf` → `{token}`；写入 `x-csrf-token`；`credentials: same-origin`、`cache: no-store`；JSON body；ZIP 上传例外 |
| 请求失败 | `ApiError(message,code?,details?)` | 兼容 `{error:string}` 与 `{error:{code,message,…}}`；403 清除缓存 token，但不自动重试；`useApi` 首次挂载/URL 变化读一次，`refresh()` 显式重读 |
| 如文字标、书架、账户、管理导航 | `/projects`、`/account`、`/admin` | 管理入口仅 admin；现无动态待办徽章/统一项目页头 |
| 退出登录 | `POST /api/auth/sign-out`，body `{}` | 成功跳 `/sign-in`；现无确认框 |
| 项目模式导航 | `/projects/P`、`/ideation`、`/chapters`、`/files` | `ProjectNav` 的普通链接，无额外写请求 |
| 导出 ZIP | `GET /api/projects/P/export` | 普通下载链接；服务端归属校验；ZIP 内容与 `Content-Disposition` 下载文件名 |
| Markdown HTTPS 外链 | `SafeMarkdown` 处理用户/模型内容 | 仅 `https:`、`target=_blank`、`rel=noopener noreferrer nofollow`；外域点击/中键先 `window.confirm`；HTML 被忽略、图片仅显示隐藏提示，无图片请求 |
| 错误中的下一步链接 | `/account`、`/sign-in`、`/projects/P/files` 等 | 页面导航；不会自动付费、重写或重试模型 |

当前 CSP 为 `style-src 'self' 'nonce-…'`、`img-src 'self'`、`font-src 'self'`；旧安全设计 §3.3 示例中的 `img-src data:` 不是当前运行配置。后续不得复制原型内联字体、样式和 `onsubmit`。

## 4. 登录与书架的全部交互

| 页面/操作 | 请求或本地操作 | 字段与结果 |
| --- | --- | --- |
| 登录：邮箱、笔名、邀请码 | 本地表单输入 | `email` 必填/email；`name` 可选；`invitation` 可空（已有账户） |
| 发送登录链接 | `POST /api/login` | `{email,name,invitationCode: invitation}`；返回 `{sent:true,previewMailbox:boolean}`；成功显示发送提示；服务端魔法链接默认 15 分钟、一次性使用、登录限流 |
| 打开本浏览器预览邮件 | `GET /api/preview/mail` | `{url}`；导航到验证 URL；仅 preview 模式、带当前浏览器 mailbox Cookie |
| Google 登录 | `POST /api/auth/sign-in/social` | `{provider:"google",callbackURL:"/projects"}` → `{url}`；跳转；未配置按钮禁用 |
| 新建项目/空书架按钮 | 本地 `setForm(true/!form)` | 展开现有页内表单，不调用 API |
| 项目名称、起始类型 | 本地表单输入 | `title` 必填、最多 100；`mode=blank|demo` |
| 创建项目 | `POST /api/projects` | `{title,mode}` → `{id}`（201）；成功跳 `/projects/id` |
| 收起新建表单 | 本地 `setForm(false)` | 无 API |
| 导入 ZIP 文件选择 | `POST /api/projects/import?title=…` | ZIP 二进制 body、`content-type: application/zip`；title 取去掉 `.zip` 的文件名；返回 `{id}` 后进入项目 |
| 点击项目行 | `/projects/P` | 读取目标项目；书架当前按 `created_at DESC`，不是最近更新时间 |

书架响应仅 `id,title,project_key,created_at,pending`。`pending` 的 SQL 是该项目 `pipeline_runs.status LIKE 'AWAITING%'` 的数量，**不含构思预览**；没有 `updated_at`、字数、演示标记或已写章数。导入错误多为 HTTP 状态加中文 `error` 字符串，不存在统一的“ZIP 结构错误码”字段。

## 5. 项目概览、章节与资料提交的全部交互

### 5.1 概览

- “进入章节写作”→ `/projects/P/chapters`；“查看项目资料”→ `/projects/P/files`。
- 最近运行每行→ `/projects/P/chapters?run=R`；概览没有单独的批准按钮、五步状态条或构思待办请求。
- 详情/readiness 的真实响应均为 `{project:{id,project_key,title},readiness:{ready,errors},state}`；readiness 没有逐项 `checks`、总资料数或文学评分。另有 `/api/projects/P/readiness` 路由，但当前组件未直接调用。

### 5.2 章节

| 操作/控件 | 请求或本地操作 | 字段与结果 |
| --- | --- | --- |
| 章节号、预览场景 | 本地表单 | `chapter` 数字输入 1–9999；场景来自 `/api/settings.scenarios`，为空不显示 |
| 开始写作 | `POST /api/projects/P/chapters` | `{chapter,simulation?}` → `{id}`（202）；选中新运行，URL 替换为 `?run=id`，刷新运行列表 |
| 运行记录 select | 本地选择 R | 替换 `?run=R`、重新挂载 RunReader、GET 详情/SSE；当前是下拉框，不是横向历史条 |
| 读者/编辑/核验 tabs | 本地 `tab` | 在同一详情内切换展示，无额外 API |
| 读者批注引文按钮 | 本地定位 | 以 `reaction.anchor` 查找编辑后正文段落，滚到 `paragraph-N`；没有唯一锚点/缺失锚点后端定位接口 |
| 作者原稿 details | 本地展开 | `original`；事实/文学修改来自独立 JSON 字符串，当前仍以文本展示 |
| 阅读确认复选框 | 本地 `confirmedDigest` | 绑定 `status + candidateSha256 + memoryPreviewSha256`；不是滚动阅读门槛 |
| 批准正文 | `POST /api/runs/R/approve-candidate` | `{confirmed:true,expectedSha256:candidateSha256,expectedTargetSha256?}` → `{accepted:true}`（202）；重读详情与列表，后台继续记忆任务 |
| 批准并提交资料变更 | `POST /api/runs/R/approve-memory` | `{confirmed:true,expectedSha256:memoryPreviewSha256,expectedTargetSha256?}` → `{accepted:true}`（202）；与正文是独立批准 |
| 退回候选稿 | 本地展开/收起表单 | 仅 `AWAITING_CANDIDATE_APPROVAL`；输入 `reason` 必填、最多 1000 |
| 确认退回 | `POST /api/runs/R/return` | `{reason}`；返回 worker 的运行结果，前端不消费其字段，随后刷新；不自动重写 |
| 放弃本次运行 | `window.confirm` 后 `POST /api/runs/R/cancel` | 默认 `{}` → `{accepted:true}`（202）；已批准正文不撤销；仅非停止状态显示 |
| 记忆逐文件 details | 本地展开 | `memoryFiles[].path/before/after`；本块前没有逐项已阅计数或段落差异算法 |
| 完整变更预览记录 details | 本地展开 | `memoryPreview` 原始 JSON 字符串；后续块再改可读字段 |
| 停止后的查看项目资料 | `/projects/P/files` | 只读导航 |

运行列表响应：`[{id,chapter,kind,status,created_at}]`。运行详情响应：

| 字段 | 真实结构与现用途 |
| --- | --- |
| `project` | `{id,project_key,title}` |
| `run` | `ChapterRun`：`id,projectKey,chapter,target,status,paths,roles,costTotal,events[{status,time}]`；可选 `candidateSha256,packetSha256,memoryPreviewSha256,targetBeforeSha256,returnedTo,returnReason,error,failedRole,requestSha256,literaryProblemsRecorded`；尚未生成 run.json 时返回最小占位运行 |
| `reports[role]` | `output,usage,costTotal,promptSha256,model,durationMs,readResources,runtimeMode?`；不返回 systemPrompt/transcript；按实际存在的岗位报告填充 |
| `roles[]` | `role_id,status,model,usage,cost_usd,usage_unknown,started_at,finished_at`；当前岗位条用 status 与美元成本 |
| `prose,original` | 字符串；prose 优先 candidate，否则作者稿；原稿仅实际保存时存在 |
| `factChanges,literaryChanges` | JSON 文件的字符串，缺文件为 `""`；不是已解析的数组 |
| `memoryPreview` | JSON 文件的字符串，缺文件为 `""`；需后续依实际 schema 解析 |
| `memoryFiles[]` | `{path,before,after}`；当前或历史 `base_sha256` 版本作为 before；不含文件时间、逐段计数等展示字段 |

`GET /api/runs/R/events` 是 EventSource：`delta {role,text}`、`reset {role,reason}` 带事件 ID；`status {status,roles}` 触发详情/列表刷新；另有 heartbeat/closed。`role-streams.ts` 按 session/run/role 分缓冲，按事件 ID 去重，reset 只清理对应尝试，不能用它清空已保存结果。

状态全集还包括 `READINESS_OK`、`MEMORY_PREVIEW_READY`、`MEMORY_COMMITTED` 这三个中间态（原型用词表未完整列出）；后续文案映射须覆盖它们。批准/完成时间可从实际 `run.events` 推导，不能复制原型的 10:51。

## 6. 故事构思的全部交互与字段

记 `I = /api/projects/P/ideation`、`S = sessionId`、`V = previewId`、`T = taskId`。构思 HTTP 用 `IdeationResult<T>`：成功 `{ok:true,value:T}`，失败 `{ok:false,error:{code,message,retryable,traceId,issues}}`。所有 POST 含新的 `clientRequestId`；不在 body 发送 actor/project 用户身份，locator 从路径传入。分页响应 `{items,nextCursor}`，当前每页 limit=100 并循环取全，不能只保留第一页。

| 操作/控件 | 请求或本地操作 | 字段与结果 |
| --- | --- | --- |
| 初始会话列表 | `GET I/sessions?limit=100&after?` | `IdeationSession[]`；优先 URL session，否则首项；会话按钮和 select 都只切选中 ID、更新 URL |
| 切换会话/刷新 | `GET I/sessions/S`；`/messages`；`/previews`；`/tasks` | 后三者分页；分别取 session/messages/previews/tasks；本地清理旧选中预览、错误、回执与未发送消息 |
| 新建会话表单 | `POST I/sessions` | `{clientRequestId,title}` → `IdeationSession`；标题最多 80；选中新会话 |
| 关闭会话 | 确认后 `POST I/sessions/S/close` | `{clientRequestId}` → closed session；关闭后不能发新消息，旧任务/预览仍保留 |
| 对话输入、计数 | 本地 `message` | Unicode 码点计数；限制取服务端 prop `chatLimit`；不改变任务 |
| 发送给协调员 | `POST I/sessions/S/messages` | `{clientRequestId,expectedSessionRevision,content}` → `IdeationMessageAccepted {sessionId,messageId,turnId,sessionRevision}`；清输入、刷新；currentTurnId 存在时禁用发送 |
| 预览类型 select、列表按钮 | 本地 filter/selectedPreview | 六类 kindNames；无需新增请求；选定本地已加载预览 |
| 预览阅读确认 | 本地 confirmed | 卡片 key 绑定 `id:sha256:closed`；版本变化重建确认状态 |
| 批准五类预览及逐字预览 | `POST I/previews/V/approve` | `{clientRequestId,expectedSha256,confirmed:true}` → `IdeationApprovalReceipt`；表现激活阶段用下一行接口；成功后 refresh/router.refresh |
| 表现资源激活/试写已阅 | `POST I/previews/V/activate-expression` | 再加 `{resourceId,expectedResourceSha256,trialReadConfirmed:true}`；需审计/试写通过、用户勾选；不能省略这些字段 |
| 修改意见/拒绝理由输入 | 本地 `text` | 决策前检查 `chatLimit`；不是直接修改项目文件 |
| 交回协调员修改 | `POST I/previews/V/revise` | `{clientRequestId,expectedSha256,content}` → `IdeationMessageAccepted`；关闭会话与 verbatim 不提供此能力；stale 普通预览可要求修改 |
| 拒绝此预览 | `POST I/previews/V/reject` | `{clientRequestId,expectedSha256,reason?}` → `{previewId,status:"rejected",coordinatorMessageId}`；当前没有拒绝确认框，仅 pending 显示 |
| 编译章节/作用域/来源 | `POST I/sessions/S/compile` | `{clientRequestId,chapter,scope:{volume,arc,scene_type,pov},sources:[{resourceId,expectedSha256}]}`；空作用域值归一为 null；返回 `IdeationTask`，不自动批准投影 |
| 查看任务对应预览 | 本地 filter=all、selectedPreview | 取 `task.outputPreviewIds`，滚动到预览区；不新增模型调用 |
| 取消任务 | 确认后 `POST I/tasks/T/cancel` | `{clientRequestId}` → `IdeationTask`；已结束状态不显示取消 |
| 用户消息选区 | `SafeMarkdown` 的只读 textarea 选择 | `codepointSelection` 把 UTF-16/换行位置转换为原始消息 Unicode 码点 start/end，拒绝拆开代理对 |
| 逐字保留到本章 | `POST I/messages/M/verbatim-previews` | `{clientRequestId,start,end,target:{kind:"current_chapter"}}` → verbatim preview；本章选区 ≤600 码点；仍需单独批准 |
| 逐字写入文件/目标 select | 同上 | `target:{kind:"resource_file",resourceId}`；目标来自服务端 `verbatimTargets`；选择目标只是本地状态，生成预览后再批准 |
| 预览/差异/技术信息/上次批准记录 details | 本地展开 | 所有内容来自已加载 preview/receipt；当前 Structured 仍用 JSON 文本，经 SafeMarkdown plain 显示 |

构思服务端 props 来自 `app/(studio)/projects/[projectId]/ideation/page.tsx`：`modelMode`、`chatLimit`、manifest 的 `compileScope`、注册表过滤出的 `compileSources[{id,path,sha256}]`、`verbatimTargets[{id,path}]`。补充来源仅 active、approved、world/character/story 且编译员可读；不能放宽过滤来满足设计。

| 对象 | 当前返回字段/需要保留的语义 |
| --- | --- |
| Session | `id,projectId,title,status,revision,currentTurnId,capabilities{externalSearch,modelMode},createdAt,updatedAt` |
| Message | `id,projectId,sessionId,turnId,role,content,status,createdAt`；仅协调员会话返回用户原话 |
| Task | `id,projectId,sessionId,role,stage,status,sourcePreviewId,outputPreviewIds,usage{inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,costUsd},error,createdAt,finishedAt`；没有 chargedCredits 字段 |
| Preview 公共字段 | `id,projectId,sessionId,taskId,sessionRevision,supersedesPreviewId,revision,sha256,status,summary,scope,resources,registrySha256,createdAt`；status 为 pending/approved/rejected/stale/superseded |
| handoff | `understanding{creativeValue,fixedFacts,openChoices,exampleTreatment,destination}`；`handoff{kind,recipient,payload,scope,resource_ids,approval_ref}`；`payloadSha256`。一次 handoff 的 recipient 是单岗位，不照搬原型双岗位标签 |
| file_patch | `explanation,patches,registryChanges`；patch 为 create（path/content）或 sections（resource/sections/beforeText/afterText），均有 afterSha256 |
| learning_plan | `known,unknown,plan,boundary,potentialConflicts,destination,sourceMode,execution`；external_search 未配置不可擅自切换成现有资料调查 |
| expression_candidate | `approvalStage,resource,patches,registryChanges,closureAudit{status,report,checks[]},trial{status,report,sample,nonCanonical:true}`；candidate 与 activation 两阶段分开 |
| generation_field | `chapter,generationField,characterCount,lockedEvents,lockedOrder,projection,approvedSources`；没有独立 openChoices 字段，不从正文猜造“保持开放” |
| verbatim（v1.2） | `text,characterCount,source,target` 加公共元数据；target 区分本章槽位与资源文件，包含相应目标哈希/位置，按实际类型显示；不可改选区后复用旧批准 |
| ApprovalReceipt | `id,projectId,previewId,approvedSha256,coreApprovals,createdAt,startedTaskId,committedFiles,projectionRegistered`；回执属于单次真实决定，不是每份列表预览自带批准时间；没有 actor/status/consumedAt 字段 |

`GET I/sessions/S/events?after=N` 订阅 delta/reset/message_changed/task_changed/preview_changed/approval_committed/error；校验 version/project/session/type/id、按游标去重；断线只恢复事件连接，不重发业务 POST。适配器另有 getPreview/getIdeationTask/getIdeationApproval 的 GET 能力，但当前页面没有绑定这些方法的控件。

`components/ideation/demo.ts` 与 `fixtures.ts` 是遗留本地演示/测试支撑，不是当前 `IdeationStudio` 的运行适配器；页面用 `createIdeationClient` 的真实 HTTP 边界，后续不能用 demo 补缺字段。

## 7. 账户与用量的全部交互和字段

| 操作/控件 | 请求或本地操作 | 字段与结果 |
| --- | --- | --- |
| 每日上限输入/保存 | `POST /api/billing/accounts/{user.id}/daily-limit` | `{limitCredits:number}`，安全整数 1…`daily[bank].maximum` → `{saved:true}`；成功刷新账户 |
| 恢复默认上限 | 同上 | `{limitCredits:null}`；没有自定义上限时禁用 |
| 每个套餐的购买测试点数 | `POST /api/billing/checkout` | `{planId,clientRequestId:crypto.randomUUID()}`；成功只创建结账、刷新账户，不直接加点 |
| 完成模拟支付 | 确认后 `POST /api/billing/checkouts/C/complete` | 默认 `{}`；仅 mock+pending+prepared_at、sandboxEnabled 时显示；刷新账户；幂等加沙箱点 |
| 外部测试结账链接 | SafeMarkdown HTTPS 链接 | `checkout.external_url`，继续保留外链确认；本块不实际购买 |
| 登出所有设备 | 确认后 `POST /api/auth/revoke-sessions` | `{}`；成功跳 `/sign-in`，包含当前会话 |
| Token/缓存 details | 本地展开 | 当前 JSON 形式显示 `usage`；后续普通用户页改版再移除 |

`GET /api/account` 实际字段：

- `user`（现组件用 id/email）、`balance`、`localRealPreview`、`bank=live|sandbox`、`banks.{live,sandbox}.{balance,reserved,available}`、`frozenAt`。
- `daily.{live,sandbox}`：`day,limit,used,held,remaining,customLimit,defaultLimit,maximum,timezone:"UTC"`；按 UTC 日和 bank 分别计算；**已有预留也占用上限，降低上限会阻止后续新调用**，不能写成“所有运行中任务完全不受影响”。
- `usage[]`：最近 100 条，`id,run_id,role_id,model,usage,cost_usd,usage_unknown,started_at,mode,title,charged_credits,bank`；点数为字符串/nullable，不能把 null 当零；没有 session 标题、chapter、运行状态、项目 id 或完整月度合计。
- `ledger[]`：最近 100 条，`id,bank,delta_credits,reason,created_at`；含 role_usage，按运行求和与账本合并展示须避免重复算消费。
- `reservations[]`：`id,run_id,bank,amount,remaining,status,held_usd`，仅 active/review；没有时间字段；`reviews[]`：`id,run_id,action,actual_cost_usd,charged_credits,reason,created_at`。
- `checkouts[]`：最近 20 条，`id,provider,plan_id,credits,price_minor,status,external_url,prepared_at`；`plans[]` 来自运行时 billing 配置，现页面用 `id,name,credits,priceMinor`。
- `sandboxEnabled,release,calibration`。`sandboxEnabled` 不是“真实收费已开放”，不因设计新增真实付款承诺。

## 8. 管理后台、资料页与公用展开项

| 页面/控件 | 请求或本地操作 | 字段与结果 |
| --- | --- | --- |
| 项目资料文件按钮 | `GET /api/projects/P/files?path=encodeURIComponent(path)` | `{path,text,sha256}`；paths 列表只含路径，不含 size/updated_at |
| 查看原文复选框 | 本地 raw 开关 | Markdown/plain 切换；不修改文件；注册表从 JSON 文本解析后匹配 path |
| 资料状态/权限 | 已读取的 `治理/资源注册表.json` | `resources[].path/status/scope/readers` 等；当前以 JSON 文本显示，不是独立元数据接口 |
| 管理：处理待核对预留 | `/admin/reservations` | 导航 |
| 生成一次性邀请码 | `POST /api/admin/invitations` | `{}` → `{code}`；当前只在本次页面状态显示明文邀请码 |
| 人工复核并解冻 | 确认后 `POST /api/admin/accounts/A/unfreeze` | `{confirmed:true,expectedFrozenAt:account.frozenAt}`；成功刷新管理数据；旧风险事件/审计保留 |
| 返回运行概况 | `/admin` | 导航 |
| 核对方式/费用/理由表单 | `POST /api/admin/reservations/B/resolve` | `{confirmed:true,action:"settle"|"release",actualCostUsd:cost,reason,expectedRemaining:row.remaining}`；客户端现两种 action 均带 cost（可能为空）；服务端 release 不消费 actualCostUsd；理由必填≤2000 |
| 404 回到我的项目 | `/projects` | 导航 |

`/api/admin` 数据：`users,projects` 计数；`failures[{id,role_id,status,started_at}]`（最多50）；`release`；`security{enforcement,enforcedLimits{freezeScore},calibration,designLimits,accounts,riskAudit,audit}`。账户风险行有 `id,email,score,events,lastEvent,frozenAt`，审计行有 actor/action/outcome/time 等；管理页不提供稿件或完整转录读取。

`/api/admin/reservations` 行：`id,run_id,email,bank,remaining,held_usd,created_at`。结算按运行总实际费用追加差额，不覆盖旧账；释放仅释放剩余预留；这些规则不属于视觉改版范围。

除表中独立操作外，所有 `<details>/<summary>`（原稿、差异、小节、注册表、来源/作用域/指纹、批准回执、编译来源、Token 缓存等）仅展开已加载数据，无额外网络操作。所有普通输入/checkbox/select 先改本地状态，只有对应提交按钮触发上表请求。

## 9. 后续块的数据降级记录

已在 `docs/OPEN_QUESTIONS.md` 增加“前端改版缺数据 · 块 0”，不新增接口：项目最近更新/演示身份/统计、pending 的统计边界、完整月度消费与用量归属、资料元数据/预览字段不足。后续按对应块隐藏缺失字段或使用准确的通用文字，不伪造 9 项就绪、完成时间、批准人、IP 位置或金额。

特别注意：指令包仅指定本轮规则与清单；块 1–11 未开始。块 0 的验证/截图适用性、实际命令结果和原型预览限制见 [00.md](00.md)。

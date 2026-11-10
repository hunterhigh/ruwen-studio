# 构思服务契约 v1.1（contract only）

日期：2026-11-10。类型与函数签名：`packages/pipeline/src/ideation/contract.ts`，仅类型导出。主线程用`import type { IdeationService, IdeationPreview, IdeationEvent } from "@ruwen/pipeline"`编写假数据适配器；**没有可以调用的真实服务函数、构思路由、队列处理器或数据库实现**。v1.1补充会话列表/关闭及章节与构思共用的运行前置错误码；v1.1合并后才按第9节实现，事件wire version仍为1。

依据PLAN §6.4/§7.2、上游`ruwen-gushi-gousi/SKILL.md`、`shared/information-contract.md`、`shared/creative-communication-contract.md`与当前core的确定性校验。上游原文不变，I1–I13不变。与计划表格的两处差异见OQ-005、OQ-018及ADR-011。

## 1. 调用边界与类型

`IdeationService`是无实现的函数签名集合。每个函数接收服务端构造的`IdeationActor {userId,projectId}`与请求DTO，返回`Promise<IdeationResult<T>>`。actor来自认证会话和已校验的路由参数，绝不能从JSON body读取userId/ownerId。公开JSON结果为`{ok:true,value:T}`或`{ok:false,error:IdeationError}`。

ID品牌只用于防止混淆，不是验证器或权限证明。JSON解析后仍必须校验格式、精确字段、长度、归属及状态；不能仅靠TypeScript断言、隐藏按钮或前端哈希。`IdeationSafeText`也只是“已经服务端验证”的类型声明，不能用类型转换代替安全检查。时间使用UTC ISO 8601，哈希为64位小写十六进制，游标是十进制字符串，不转换成浮点数。分页默认50、最大100；after排他，按不可变创建顺序稳定分页，不使用正文构造游标。

context scope完整包含project/volume/arc/chapter/scene_type/pov，project是上游项目key，不是数据库project UUID。注册表scope使用project/volumes/arcs/chapters/scene_types/povs，复数维度为数组或null；两种scope不得混用。资源只按合法type、路径、状态、readers和scope读取，不因用户拥有项目而扩宽模型权限。

新消息、修改意见、拒绝理由遵守config/security.ts输入预算（默认单条8000码点），非空正文按trim检查但数据库保存原字节措辞；不通过隐式改写来“消除原话”。标题最多80码点，只在协调员工作区使用。creation-check仍执行core的精确payload白名单、字段长度、数组数量、嵌套及原话重合限制，不因TypeScript数组/字符串类型而省略。

## 2. 会话、消息和通讯门

1. `createIdeationSession`创建属于当前项目的协调员会话；`getIdeationSession`读取会话状态、revision、当前协调员turnId和服务能力。会话状态open/closed。标题只用于协调员工作区，不复制到下游或事件。
2. `listIdeationMessages`是唯一返回用户原话的消息列表接口，只接受本会话游标。role只有user/assistant，assistant只代表创意协调员；不返回system、thinking、签名或其他岗位转录。
3. `sendIdeationMessage`只收一条新消息、sessionId、expectedSessionRevision和clientRequestId。先持久化用户消息，再创建协调员回合，返回messageId/turnId/sessionRevision，HTTP 202。客户端不传历史对话、角色、系统提示词、工具、模型或批准状态。同一会话只有一个未完成的协调员回合；冲突返回TURN_IN_PROGRESS。
4. 协调员每个模型请求都从数据库重新载入本会话所需消息，构造prepareRequest上下文；不依赖浏览器重放历史。工具限定list_resources、受readers约束的read_resource、propose_handoff。
5. propose_handoff先调用当前`core.handoff.validateHandoff(value,{rawSource})`执行creation-check；rawSource只从数据库在协调员阶段短暂读取。失败不生成快照，不用人工拼接绕过。成功生成`kind:"handoff"`预览，包含自然语言理解、干净委托、作用域、资源引用及待运行岗位。
6. 公开委托保留上游精确snake_case字段，approval_ref为null。当前构思分派支持治理、顾问、表现、故事四岗；这是上游creative_brief白名单的子集，不把编辑岗作为构思任务。本契约不改变上游允许的面向当前候选编辑的委托。编译员走独立编译请求，不能把它加进creative_brief.recipient。

`listIdeationSessions(actor,{after?,limit?,status?})`按第1节分页规则列出当前已授权项目的会话，status可选open/closed；省略时包含两种状态，非法过滤值为INVALID_ARGUMENT。先检查projectId归属，再过滤/计数/分页，不能通过过滤或游标读到其他项目的会话；空列表也不免除项目归属校验。

`closeIdeationSession(actor,{sessionId,clientRequestId})`返回`IdeationClosedSession`（status固定closed），HTTP 200。关闭只停止新的协调员输入：后续sendIdeationMessage，以及会创建新协调员用户消息/回合的revisePreview，均返回SESSION_CLOSED（409）。关闭不取消或中断已有任务，不使现有预览stale/superseded，不改变其哈希、批准或已提交文件；已有预览的读取、批准、拒绝、激活及任务查询/取消/事件订阅继续遵守各自原有门。拒绝理由仍只作为会话内决定备注保存，不发起新协调员回合；已接收的协调员任务也可正常收尾。

关闭与发送按服务端事务提交顺序串行决定：先关闭则新发送被拒，先受理发送则该已存在任务不受关闭影响。关闭幂等；同clientRequestId按第4节重放结果，其他请求ID再次关闭已关闭会话也返回closed，不重复修改状态或创建任务。本契约不提供重新打开操作。

**用户原话只出现在协调员会话里。任何下游预览和事件都不包含原话。** 不在快照、任务请求、注册表、审计、错误、SSE、录制或导出中复制用户消息、修改意见、拒绝理由、示例原句或失败历史。下游只拿白名单干净委托及有权读取的项目资料，不读协调员消息表；不能将整个会话DTO作为模型输入。会话消息表不属于项目文件系统或项目ZIP。

预览字段、补丁说明和事件文本在发布前还要与数据库原话做隔离校验；不能仅靠系统提示词泄露检测器。用户原话的新增/修改不作为delta事件广播，message_changed只发ID与状态，前端再经消息接口取文本。协调员如需在会话内显示原话引用，只能经会话消息读取；事件版文本也不得携带原话引用。后续实现必须使用哨兵覆盖预览、全部事件、错误、快照与下游实际模型请求。逐字文本不混入创意委托；本契约不新增exact-text写入入口，仍需独立的上游逐字通道和600字上限。

## 3. 下游任务与预览种类

任务DTO只返回ID、关联预览ID、岗位、阶段、状态、用量和安全错误，不返回输入快照、对话、原话或完整transcript。runId同时用于协调员turn与下游task，均为pipeline run UUID。角色/阶段由服务端确定，不能由客户端指定。

任务状态：QUEUED → RUNNING → AWAITING_PREVIEW_APPROVAL或AWAITING_LEARNING_PLAN_APPROVAL → SUCCEEDED；失败/取消为FAILED/CANCELLED。模型响应后尚未可靠保存而崩溃为INTERRUPTED：不自动再次调用模型或把未知费用伪造为0，沿用worker检查点与人工核对规则。拒绝输出预览后关闭该待批任务；任何后续重做都创建新任务。非终态可取消，取消不撤销已批准文件，并保留已用usage.cost；costUsd是十进制字符串，未知为null。

所有预览有id、projectId、sessionId、taskId、sessionRevision、revision、sha256、status、scope、资源和注册表哈希。状态为pending/approved/rejected/stale/superseded。预览可执行内容不可变；修改产生新预览ID并通过supersedesPreviewId关联旧版，不能覆盖已展示或已批准内容。sessionRevision绑定协调员创建该预览时的数据库消息边界，creation-check使用该边界内的原始来源；无关的新对话不自动撤销已有预览或批准。显式修改使目标旧预览失效，资源/证据/注册表哈希变化也必须标记stale。

| kind | 内容 | 批准效果与禁止事项 |
|---|---|---|
| handoff | 理解预览、creative_brief或consultant_brief、payloadSha256 | 服务端重算哈希并创建handoff_execute；消费一次后分派干净任务，不写Canon。 |
| file_patch | 小节补丁/新建文件、服务端计算的前后对比、说明、注册表变更 | 单事务提交用户已批准的文件、注册表和技术审计；现有文件只做有base哈希的小节替换，不提供任意覆写/删除接口。研究输出只为证据，不替用户决定Canon/剧情/声音。 |
| learning_plan | 已知、未知、计划、搜集边界、冲突、归属和干净consultant_brief | 首次只运行计划阶段；批准后才可调查。sourceMode可为existing_materials或external_search。后者没配置SearchProvider/key时SEARCH_UNAVAILABLE，保留pending；不得偷换来源或真实联网。前者不提供web_search。调查结果另生待批预览。 |
| expression_candidate | proposed/candidate资源、approvalStage、补丁、六项闭合审计与隔离非正典试写证据 | 按上游：审计通过才candidate，试写+用户阅读+expression_activate才active。candidate阶段的approvePreview至多提交通过审计的candidate；绝不自动active。 |
| generation_field | ≤2200码点的generationField、锁定事实/顺序、投影引用、已批准来源 | 用户批准后同事务落投影、调用core.state.registerProjection并保存审计/批准记录；不能附带规划理由、来源解释或用户对话。 |

小节补丁沿用core.applySectionEdits约束：heading必须现有且唯一，不能引入同级/上级标题；每资源最多8小节、每小节正文最多4000码点。base哈希必须等于本次授权读取和提交时的实际文件哈希；afterText/afterSha256由服务端计算。新文件仅在目标不存在时独占创建，合法路径与资源ID/类型归属同时成立。active表现资源不得直接refresh-hash，应建立新版本重新审计、试写和激活。

registryChanges明确列出前后owner、version、readers、allowAuthor、supersedes及资源状态/路径/作用域/哈希；resourceId必须与前后记录的id一致，supersedes也只能解析本项目资源。批准事件ID等事务生成的技术元数据在receipt返回，不由模型或客户端提供。

`requestIdeationCompilation`只收sessionId、章节、scope和来源资源ID/预期哈希，不收brief、原话、generation field正文或锁定事实文本。后端从已批准故事、当前状态、有效世界与Canon构造输入，读取白名单不变；就绪失败、来源变化或记忆合并未完成必须返回PRECONDITION_FAILED/RESOURCE_STALE。

预览中的新文件/投影引用可以指向拟建文件，此时其哈希是服务端计算的拟写入字节哈希，不代表文件已提交。目标须由当前已授权预览分配、提交时仍不存在并独占创建；不存在的新资源ID不能拿来读取其他项目的同名资源。

`activateExpression`是独立明确动作，除confirmed外还需trialReadConfirmed；服务端重新核对candidate、资源哈希、审计、试写及作用域，创建expression_activate。candidate提交之后，试写证据就绪时生成新的pending预览（approvalStage:activation），不能修改已经批准的candidate阶段快照。approvePreview只接candidate阶段，activateExpression只接activation阶段，每个预览仍只决定一次。布尔字段不能代替实际证据。试写必须隔离、非正典，不让candidate混进正式作者资料包（I8），不自动调用章节提交链。

## 4. 批准、拒绝、修改与幂等

**所有批准都由服务端重新计算哈希。** `expectedSha256`只用于检测用户所见预览是否陈旧；`expectedResourceSha256`和编译来源哈希也只用于陈旧检查。服务端重新读取权威快照原始字节、目标文件、注册表、证据及引用资源，计算哈希并校验关联，而不是散列客户端传回的JSON。哈希不含可变status；所有影响执行的字段（目标、接收者、作用域、补丁、注册表变更等）都在不可变快照内。

handoff的预览快照哈希与独立payload哈希是两个边界。两者都核对，core.handoff执行批准按其原有语义绑定`治理/交接/`中的独立payload字节；不能误把预览外层哈希当payload哈希，也不能只校验payload后任意改变接收者。

approvePreview必须confirmed:true，服务端生成批准ID与记录，检查pending及当前版本，按预览类型分派/提交。需要上游批准门时只用现有handoff_execute、resource_activate、expression_activate及其reserve/commit/rollback，不发明learning_plan_approve或把普通文件变更伪装成memory_commit。通用文件预览的用户决定是平台哈希绑定的预览凭证，不是新增上游action；与文件、注册表和技术审计在同一项目事务中保存。coreApprovals返回实际发生的上游批准引用，可以为空；用户不能提交它们或自行选择action。所有失败回滚消费与写入，重复批准不得再次执行、计费或消费。

`IdeationApprovalReceipt`包含平台decisionId、已批准预览哈希、实际core批准引用、新任务ID、提交文件及投影登记结果；不包含原话/拒绝理由。项目中保存的技术决定证据也不含原话；上游格式的批准事件仍保持原有文件和哈希语义，不用平台凭证绕过core门。

rejectPreview改变pending为rejected，不修改Canon，取消尚未开始的关联执行；可选reason只追加协调员会话消息，不放入预览、下游或事件。revisePreview只接受pending/stale，将旧版标记superseded，content只作为新的协调员用户消息，返回messageId/turnId；协调员重新转译、creation-check并生成新预览。已决定版本不能原位修改，用户可发新消息另起预览。修改不等于批准，不直接把用户编辑文本发送给下游。

所有写操作带clientRequestId（UUID）。幂等键绑定userId+projectId+操作+请求ID和经过校验的请求摘要；同键同内容返回原结果，同键不同内容IDEMPOTENCY_CONFLICT。不同请求ID重复决定已决定预览返回ALREADY_DECIDED，不能创建第二个批准；仍先检查归属，不能利用幂等查询越权。客户端不能指定approved_by、ownerId、任务role、批准事件路径或服务端目标哈希。

## 5. 事件与reset

会话SSE和listIdeationEvents使用同一已持久化事件流；沿用章节的worker串行落盘、游标与通知/轮询机制。只有安全层放行的onDelta可进入delta，不能从原始模型输出/响应补写事件。新增构思事件文本还须满足第2节原话隔离；thinking、系统消息、失败片段和原话从不作为事件字段。

`IdeationEvent`是扁平可辨别联合：公共字段version:1/id/projectId/sessionId/runId/createdAt，加type及该类型字段。SSE的event等于type，id等于事件游标，data为整个事件JSON；list返回相同对象。delta/reset的role/text或role/reason仍在根层，与章节帧兼容；额外runId用于同一会话的多个任务分流。主线程以(sessionId,runId,role)管理流式缓冲，不能只按role把不同任务拼起来。

```text
id: 104
event: reset
data: {"version":1,"type":"reset","id":"104","projectId":"<project UUID>","sessionId":"<session UUID>","runId":"<run UUID>","createdAt":"2026-11-10T00:00:00Z","role":"chuangyi-xietiaoyuan","reason":"security_refusal"}
```

| type | 独有字段/消费方式 |
|---|---|
| delta | role,text；追加到该任务该岗位的当前尝试。text为已放行文本。 |
| reset | role,reason；立刻清空该任务该岗位已显示流，再接受后续delta。reason仅format_correction/prompt_overlap_correction/security_refusal；不删除最终结果、会话消息或usage。 |
| message_changed | messageId,turnId,status；经会话消息接口读取内容，不推原话。 |
| task_changed | taskId,status；必要时重新getIdeationTask。 |
| preview_changed | previewId,status,sha256；重新getPreview，不在事件嵌套预览或原话。 |
| approval_committed | decisionId,previewId；读取批准凭证。 |
| error | error；只允许公开错误码/安全文案，不能附原始异常。 |

同一任务中delta…→reset→delta…或delta…→reset→固定拒绝语必须保持原顺序，不能跨reset合并、丢弃或延迟reset直到新delta之后。重置即使发生在首个delta前也要保留。数据库写失败不能丢reset后继续发字。安全拒绝或纠正产生的reset不改变费用事实与检查点。

重连用Last-Event-ID或after，排他重放；若两者都有，以header为准。前端按id去重后消费，重复reset不应在新文字之后再清空。新订阅可从0重放或从已保存游标继续，不把“重连”视为新的模型尝试。heartbeat是无持久化游标的连接保活，不能拿来推进消息游标。每次SSE建立及轮询都重查认证/归属；权限丢失立即关闭，不继续发送已排队内容。游标只代表位置，不授予任何资源权限。

## 6. HTTP映射（待实现）

以下均以`/api/projects/:projectId/ideation`为前缀，**本PR不注册这些路由**。所有写请求校验CSRF；先校验全部ID归属，再做状态/哈希/幂等检查。查询分页使用after/limit；GET /sessions的可选status也使用查询串，例如`?status=closed&limit=50`。

| 方法与路径 | 服务函数 | 需纳入归属/越权测试的ID |
|---|---|---|
| POST /sessions | createIdeationSession | projectId |
| GET /sessions | listIdeationSessions | projectId、会话列表游标（status过滤不改变归属范围） |
| GET /sessions/:sessionId | getIdeationSession | projectId,sessionId |
| POST /sessions/:sessionId/close | closeIdeationSession | projectId,sessionId；clientRequestId仅为当前用户/项目内幂等键 |
| GET /sessions/:sessionId/messages | listIdeationMessages | projectId,sessionId,消息游标 |
| POST /sessions/:sessionId/messages | sendIdeationMessage | projectId,sessionId |
| GET /sessions/:sessionId/previews | listPreviews | projectId,sessionId,预览游标 |
| GET /previews/:previewId | getPreview | projectId,previewId |
| POST /previews/:previewId/approve | approvePreview | projectId,previewId |
| POST /previews/:previewId/reject | rejectPreview | projectId,previewId |
| POST /previews/:previewId/revise | revisePreview | projectId,previewId及其session |
| POST /previews/:previewId/activate-expression | activateExpression | projectId,previewId,resourceId、审计/试写引用 |
| POST /sessions/:sessionId/compile | requestIdeationCompilation | projectId,sessionId、全部sources.resourceId |
| GET /sessions/:sessionId/tasks | listIdeationTasks | projectId,sessionId、任务游标 |
| GET /tasks/:taskId | getIdeationTask | projectId,taskId(runId) |
| POST /tasks/:taskId/cancel | cancelIdeationTask | projectId,taskId(runId) |
| GET /decisions/:decisionId | getIdeationApproval | projectId,decisionId |
| GET /sessions/:sessionId/events | listIdeationEvents的SSE适配 | projectId,sessionId、所有返回事件的session/run关联 |

读成功200，关闭成功200，新消息/修改/编译受理202；批准产生的任务以receipt.startedTaskId查询，文件提交则在同一200响应前完成事务。状态冲突409；运行前置拒绝使用第8节共用错误码，不得创建失败占位任务或假装202。

## 7. 所有ID与归属规则

| 名称/格式 | 权威归属与必须检查的关联 |
|---|---|
| userId：认证用户UUID | 仅认证会话提供，不能由body/查询串指定。 |
| projectId：数据库UUID | projects.owner_id等于当前用户；创建/列举会话都先校验该项目，列表的status、计数、分页不能扩宽到其他项目；不能把projectKey当UUID。 |
| sessionId：UUID | session.project_id等于已授权projectId；读取/关闭/消息等操作都检查父子关联，不能仅查session UUID存在。关闭也不能先返回SESSION_CLOSED等状态来泄露外租户会话。 |
| messageId：UUID | message.session_id/project_id同时匹配本会话/项目；只有协调员会话消息端点可读。 |
| turnId/taskId/runId：pipeline run UUID | run关联同一项目及会话；校验run kind与操作（协调员/分派/调查/编译）一致。沿用run归属守卫，补会话关联。 |
| previewId：UUID | preview.project/session/run全部一致；包括supersedesPreviewId链与source/output preview IDs，不能用一个项目的任务包住另一个预览。 |
| decisionId：平台UUID | 绑定同一项目、预览、哈希及认证用户的决定；不把它当core批准事件ID。 |
| resourceId：上游[a-z0-9-]{2,64}标识 | 仅在当前项目注册表命名空间中有意义，不全局唯一。检查readers、scope、状态、类型/目录及实际哈希；所有数组元素均检查，不能只查第一个。 |
| core approval id：上游3–64位小写数字/字母/连字符 | 必须结合本项目治理/审批路径、目标哈希和单次消费标记；不是平台UUID查询接口。receipt中的引用由服务端生成/验证，不收客户端伪造引用。 |
| file/projection/audit/trial路径与sha256 | 只在当前项目FS解析，禁止绝对路径、逃逸、符号链接与跨项目引用。报告证据和目标资源/作用域/哈希匹配，不因路径存在就视为通过。引用的path不是新的无归属下载入口。 |
| projectKey：上游slug | 从已授权项目读取，只参与上游scope和资源匹配，不能授予平台访问权。 |
| clientRequestId：客户端UUID | 只用于绑定用户+项目+操作的幂等键，不能定位/授权其他请求。 |
| 游标：不透明十进制字符串 | 会话列表限定当前project，消息/任务/预览/事件限定当前project/session，只代表各自列表的排他位置。不得用游标绕过父资源鉴权，也不得从游标查询无归属对象。 |
| role/type/status/action/sha256/traceId | 静态分类、校验值或关联号，不是授权资源ID；知道它们不授予任何访问。prompts表没有公开查询入口。 |

主线程实现路由时扩展统一requireOwnership的资源定位联合；不能为构思另建一个跳过统一守卫的控制器。每条新增路由都加入API_ROUTES及动态A→B=404测试，另测混搭同租户不同项目/会话/任务/预览和嵌套资源ID。未知、非法格式、其他租户或错父子关联统一NOT_FOUND/404，先于状态冲突；不能通过错误码、计数、幂等响应、SSE重连或导出探知其他项目。重放与分页也重查归属。

v1.1必须把GET /sessions及POST /sessions/:sessionId/close加入同一越权覆盖：外租户项目的列表（含open/closed过滤、空结果和游标）为404；关闭外租户会话、同租户错项目会话、非法/未知会话均为404。被拒关闭不能改变目标状态或任何任务/预览，重复关闭的幂等分支也不能跳过归属校验。

## 8. 错误码

| HTTP | code |
|---|---|
| 401 | UNAUTHENTICATED |
| 404 | NOT_FOUND（包括非法ID、外租户、错父子关联） |
| 403 | CSRF_INVALID、BILLING_DISABLED（收费关闭时的付费功能） |
| 400 | INVALID_ARGUMENT |
| 402 | INSUFFICIENT_CREDITS（可用余额不足以预留本次运行） |
| 413 | INPUT_LIMIT_EXCEEDED |
| 422 | CREATION_CHECK_FAILED、OUTPUT_BLOCKED |
| 423 | ACCOUNT_FROZEN（风控冻结，待人工复核） |
| 409 | TURN_IN_PROGRESS、SESSION_CLOSED、RESOURCE_STALE、PREVIEW_STALE、ALREADY_DECIDED、APPROVAL_REQUIRED、APPROVAL_CONSUMED、IDEMPOTENCY_CONFLICT、SEARCH_UNAVAILABLE、CLOSURE_AUDIT_REQUIRED、NONCANONICAL_TRIAL_REQUIRED、PRECONDITION_FAILED、CANCELLED、INTERRUPTED、READERS_DENIED |
| 429 | RATE_LIMITED |
| 503 | PROVIDER_UNAVAILABLE |
| 500 | INTERNAL_ERROR |

错误只有code、安全文案、retryable、traceId和field/rule问题列表。field是服务端认可的字段位置，rule为固定代码，不能附原始值、原话、系统提示词、标记、thinking、SQL或provider异常。retryable不是自动重试授权：模型调用仍遵守成本、检查点、用户确认与已定义的一次纠正规则。

### 章节与构思共用的运行前置检查（v1.1）

`RunStartErrorCode`及HTTP映射类型`RunStartErrorStatus`由`@ruwen/pipeline`统一类型导出，只有INSUFFICIENT_CREDITS→402、ACCOUNT_FROZEN→423、BILLING_DISABLED→403这三项；IdeationErrorCode直接复用它们。章节接口以后接入计费/风控时也使用同一组代码和HTTP含义，不另起同义错误码。本轮只补契约，不代表余额预留、冻结或收费逻辑已经接入。

先完成认证和**全部相关资源归属校验**，再执行这组运行前置检查；它们必须发生在创建任务、入队或调用模型之前。外租户/错父子关联仍为NOT_FOUND/404，不能先暴露余额、冻结或收费状态。新运行被这三种错误拒绝时，不创建任务（包括失败占位任务）、不调用模型、不扣费，也不遗留预留/消费或“已受理”结果；检查通过后的预留与任务受理须原子完成，避免竞态超扣。

执行排队任务的实际模型调用前仍要重查归属及适用的前置条件；如果此时被拒，不创建替代任务、不发起该模型调用、不产生新的扣费，并释放未使用的本次预留。原有任务的已发生用量/费用事实不回写或伪造为0。BILLING_DISABLED只用于依赖收费启用的付费功能，不能把默认关闭真实收费解释为禁用faux验证或所有非付费操作。

## 9. 后续实现验收门

v1.1合并后，后端才能实现DB持久化、prepareRequest加载、creation-check、用户批准再分派和各预览原子提交。必须以faux证明：完整流程、creation-check拒绝、未批准写入阻断、重复批准/幂等冲突、原话哨兵隔离、无搜索配置、表现审计/试写/激活门、2200字预算、reset顺序与SSE重连、所有资源ID越权及worker检查点恢复。还须验证会话列表状态过滤/分页不越权、关闭幂等与发送并发顺序、关闭后发送/修改为SESSION_CLOSED且既有预览/任务不变，以及三种运行前置拒绝在鉴权之后且任务/模型调用/扣费均为零；章节接入时复用同组错误码验收。不把当前类型检查或假数据页面当成这些实现已验收。

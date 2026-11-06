# 如文 5.0 上游接口清单

核验日期：2026-11-06。来源：`hunterhigh/ruwen-writing-system` 的 `v5.0.0`，固定提交 `9835470fa07b216c85602915a38063b0d7c937b5`。本文以该提交源码为准。

以下 `PLUGIN` 指 `vendor/ruwen/01-完整插件/ruwen-xiezuo-xitong`；Python 脚本均在 `PLUGIN/scripts/`。覆盖 12 个业务脚本、`test_ruwen_v5.py`、12 个岗位，两份 SKILL.md 和共享契约。其他组件及小说旧项目不作为核心测试夹具。上游内部私有子模块未初始化。

## 调用与移植的共同约定

- 普通成功输出为 UTF-8 JSON，`ensure_ascii=False`，CLI 通常缩进 2。哈希对原始文件字节计算，不能对解码后的文本或换行规范化结果计算。
- Python `len(str)` 计算 Unicode 码点；TS 不能直接用 UTF-16 的 `string.length` 代替。作用域排序、集合排序和路径排序也需显式对齐。
- `sha256_directory`：按 Python 路径排序遍历文件，逐项向摘要追加 `相对POSIX路径UTF-8 + NUL + 文件sha256的ASCII + LF`。
- 通用 argparse 参数错误退出 2，`--help` 退出 0。下文分别标出业务错误退出码；未捕获异常通常退出 1 并打印 traceback，不能统一假定所有脚本业务错误都退出 2。
- 上游脚本依赖同目录 import。计划示意中的 `python -I scripts/x.py` 会剥离脚本目录，不能直接用于所有脚本；差分测试需在隔离进程中显式配置只包含上游脚本的导入路径。
- Windows 全局 `core.autocrlf=true` 会改变模板批准事件字节，使已嵌入注册表的批准事件哈希失效。`pnpm test:upstream` 使用 `git archive HEAD` 导出原始提交到临时目录运行，不修改 vendor，不重算或绕过批准哈希。
- 文件级原子替换不等于跨文件事务。P1 的 ProjectFS 必须补齐计划要求的事务，不能把 Python 的多次写操作当成数据库级原子提交。
- 核心脚本本身不全面落实所有岗位的 `readers`；平台必须额外实现 I7。没有 Bash/任意文件工具的限制由平台负责。

## 12 个业务脚本

### 1. resource_registry.py

命令与参数：

```text
validate --project-root ROOT
select --project-root ROOT [--project ID] [--volume V] [--arc A]
       [--chapter N] [--scene-type T] [--pov P] [--author-only]
transition --project-root ROOT --resource-id ID --status STATUS
           [--approved-by-user] [--approval-event PATH]
           [--closure-audit PATH] [--trial-report PATH]
refresh-hash --project-root ROOT --resource-id ID [--approved-by-user]
```

读取 `治理/资源注册表.json`、资源文件、独立批准事件和消费标记；表现资源还读取闭合审计、人工复核、试写报告及试写产物。注册表根为 `{schema_version:"1.0", resources:[...]}`。资源字段包括 `id,path,type,owner,version,status,supersedes,scope,readers,allow_author,source_sha256,approval`。

作用域包含 `project,volumes,arcs,chapters,scene_types,povs`。`select` 只取 active、匹配作用域的资源；author-only 再过滤 allow_author，并拒绝同时命中多份表现能力。按 specificity 降序、type、id 排序。类型与目录职责匹配，supersedes 不可成环，不同职责不可相互替代。

状态边：`proposed → candidate/retired`，`candidate → active/retired`，`active → superseded/retired`；两个终态不可再转移。激活须绑定用户批准事件；表现 candidate 要闭合审计，active 另需非正典试写证据。激活时 reserve 批准，写注册表后 commit，失败 rollback 并恢复注册表。`refresh-hash` 禁止直接刷新 active 表现资源；candidate 表现刷新会退回 proposed。

写入：原子替换注册表，激活时写 `治理/审批/已使用/` 消费标记。输出：validate `{valid,errors}`；select 为资源数组；其余为更新后的资源对象。退出：validate 0/1；成功变更/选择 0；RegistryError 2。

### 2. approval_record.py

```text
--project-root ROOT --event-id ID --action ACTION --target PATH --confirmed-by-user
```

ACTION 恰为 `handoff_execute,candidate_approve,memory_commit,resource_activate,expression_activate`。读取当前目标文件字节，创建 `治理/审批/<id>.json`，不允许覆盖。事件精确字段为 `schema_version,id,action,target_path,target_sha256,approved_at,approved_by,consumed`，其中 schema 为 `1.0`、approved_by 为 user、consumed 为 false。输出 `{status:"recorded",event:相对路径}`。成功 0；显式拒绝、未捕获错误 1；argparse 错误 2。

库接口另有 `validate_event`、`reserve_event`、`commit_reservation`、`rollback_reservation`、`consume_event`、`usage_entries`、`event_is_consumed`、`event_is_committed`。reserve 使用 `治理/审批/已使用/.<id>.pending` 的独占创建并 fsync；commit 将 pending 原子 rename 为 `<id>.json`；rollback 删除 pending。消费记录字段为 `event_id,action,target_path,target_sha256,consumer,consumed_at`。CLI 只创建事件，不暴露 reserve/commit/rollback 子命令；TS 差分需测试库接口，不能虚构上游 CLI。

### 3. audit_ledger.py

```text
--project-root ROOT --event-json JSON_FILE
```

读取输入事件 JSON；白名单精确为 `role,resource_ids,change,scope,conflict_category,approval_status,result`，scope 精确为 `project,volume,arc,chapter`。change/result 只能是技术标识。追加 `time` 后写 `治理/审计账本.jsonl`，输出完整事件对象。不得在技术账本混入创意正文。成功 0；校验拒绝或未捕获异常 1；参数错误 2。

### 4. problem_ledger.py

```text
append --project-root ROOT --entry-json JSON_FILE
summary --project-root ROOT
```

只读写 `治理/文学问题账本.jsonl`，append 另读取输入 JSON。输入精确字段 `location,category,condition,handling,result,task_id,status`，均为长度 1–1000 的文本。追加 `first_seen,last_seen,recorded_at,recurrence_count,recurrence_candidate`；同类至少 3 次且跨至少 2 个 task 才标记复发候选。

append 输出完整条目。summary 输出 `{total,categories:[{category,count,task_count,recurrence_candidate}]}`，不含具体正文定位和问题内容。治理层只可获取此聚合。成功 0；未捕获校验/IO/JSON 错误 1；参数错误 2。

### 5. story_state.py

```text
init --project-root ROOT --outline PATH [--source ROLE=PATH ...]
     [--last-approved PATH] [--rewrite-cutoff N --snapshot-root DIR]
check --project-root ROOT
register-projection --project-root ROOT --projection PATH --chapter N --scope-file JSON_FILE
record-approved --project-root ROOT --prose PATH --version VERSION --approval-event PATH
promote-approved --project-root ROOT --target PATH
                 [--replace-existing --expected-target-sha256 HASH]
migrate-state --project-root ROOT (--check | --apply)
reconcile --project-root ROOT [--outline PATH] [--source ROLE=PATH ...]
          [--memory-preview PATH --memory-approval-event PATH]
          [--rewrite-cutoff N --snapshot-root DIR] [--clear-rewrite-snapshot]
```

状态文件 `authoring-ruwen-v5/state.json`，schema **2.0**（不是产品版本 5.0）。字段为 `schema_version,created_at,updated_at,active_outline,tracked_sources,last_approved_prose,pending_approved_candidate,approval_history,consumed_approval_ids,rewrite_snapshot,active_projection,active_packet,pending_consolidation,stale`；迁移时可另有 legacy_import。

读取注册表、就绪资料、active outline、跟踪来源、最近批准正文、projection/packet 的 `.meta.json`、批准事件、重写快照及记忆预览。输入 outline 只能为已批准 active 的 story；跟踪来源仅 character/world/story。引用为 `{path,sha256}`，跟踪来源另有 role。快照引用 `{cutoff,root,sha256}`。`--source` 可重复，role 不可重复。scope-file 精确为 `project,volume,arc,chapter,scene_type,pov`，chapter 要匹配命令参数。

- init 先做 project_readiness，建立 authoring 目录及初始状态；拒绝重入，不写人物/世界/故事含义。
- register-projection 检查污染、80–2200 字符及可信 scope。写 projection 同名 `.meta.json`（`schema_version,chapter,context_scope,generated_at,artifact,sources`），更新状态，失效旧 packet。它读取已存在 projection，不生成情境正文。
- record-approved 校验候选、silent floor、有效 packet 和单次批准；将候选锁入 pending，不直接写正式章节；消费事件并失效 projection/packet。
- promote-approved 只能写 `chapters/*.md`；替换要旧哈希，并先在 `authoring-ruwen-v5/snapshots/replacements/` 归档。更新 last_approved_prose/history，标记 pending_consolidation。
- reconcile 验证/刷新来源；有待合并记忆时必须提供 reports 内预览及 memory_commit 批准。它记录批准并清除 pending，不负责解释或应用任意记忆补丁；平台仍需在同一事务中应用补丁、更新注册表和审计。
- migrate-state 仅迁移本状态 schema `1.2 → 2.0`；apply 先备份到 `snapshots/state-migrations/`，不会推断旧正文是否正式。这与 v4.1 项目目录迁移不同。

输出：init/record/promote/reconcile 为完整状态；register 为 meta；check 为 `{initialized,pending_approved_candidate,pending_consolidation,projection_stale,packet_stale,source_reasons,projection_reasons,packet_reasons,ready_to_compile,ready_to_draft}`。check 即使 not ready 也退出 0，必须检查 JSON。migrate --check 为 `{status,from_schema,to_schema,changes_required,...}`；apply 返回 `{status:"migrated",from_schema,to_schema,backup,backup_sha256,legacy_import}`。成功 0，StateError 2；其他未捕获异常通常 1。

### 6. compile_author_packet.py

```text
compile --project-root ROOT --manifest PATH
check --project-root ROOT --packet PATH
```

manifest 必须位于 `authoring-ruwen-v5/manifests/`；必需键 `projection,project_voice,pov_lens,relationship_lens,expression_resource,approved_prose_tail,context_scope,output`；可选 `maximum_context_characters,user_authored_text`；禁止其他键。

读取 state、projection/meta、注册表、active 来源、作者核心段（章节 SKILL 目录 CREATIVE-SOUL 中唯一 AUTHOR_CORE 标记对）。作者核心 ≤420；包总限 3000–8000（默认 8000）；情境 ≤2200；声音 ≤1200；POV ≤900；关系/表现各 ≤900；逐字文本 ≤600；批准正文尾长参数 200–2400。**实际实现超预算报错，不自动截断**。上一章尾部与供情感读者的默认 600 字是两个独立限制。

manifest scope 必须等于已登记 projection 的可信 scope。来源路径、类型、唯一职责、哈希、active、allow_author、作用域均核验；禁止 research/report/diagnostic/notes/untitled/document 等非岗位文件名。逐字文本仅允许 `authoring-ruwen-v5/exact-text/` 且 `confirmed_verbatim=true`。

写入 `authoring-ruwen-v5/packets/` 中正文、同名 `.meta.json` 和状态 active_packet。meta 字段 `schema_version,generated_at,artifact,manifest,sources,warnings`，source 字段 `role,path,sha256,selection`。来源清单只留在 meta，不能给作者。compile 输出 `{status:"compiled",output,warnings}`，check 输出 `{valid,reasons}`。compile 成功 0，check 0/1，PacketError/StateError 2。

### 7. handoff_validator.py

```text
--file JSON_FILE [--creation-check | --for-execution] [--project-root ROOT]
```

读取交接 JSON；creation-check 只从 stdin 读取用户原话作内存重合检查，两个模式互斥，原话不能为空且不落盘。顶层精确键 `kind,sender,recipient,resource_ids,scope,approval_ref,payload`。kind 为 `creative_brief,consultant_brief,governance_preview,expression_candidate,chapter_situation,memory_change_preview`；每类 payload 有精确键集和文本/数组预算。递归拒绝 raw_user_input、reasoning、content/text/message/prompt/input/instructions 等污染字段。

执行模式对 creative_brief、consultant_brief、chapter_situation 要求批准引用 `{path,sha256}`；从 `治理/审批/` 读取事件，其目标是 `治理/交接/` 的 payload 快照；验证当前哈希、payload 内容、动作和未消费状态。CLI 验证成功后会**消费批准事件**；库函数 validate 本身不消费，另有 consume_execution_approval。普通验证和 creation-check 不写文件。

输出 `{valid,errors}`。成功 0；验证拒绝/显式模式错误/未捕获异常 1；参数错误 2。P2 注意：上游 RECIPIENTS 是闭合白名单，creative_brief 不含章节情境编译员；不能直接假定计划中的所有分派都已有同名交接类型。

### 8. project_readiness.py

```text
--project-root ROOT
```

只读 `AGENTS.md`、项目章程、主角档案、世界总表、当前态势、项目声音、注册表和两份账本，以及注册表指向的全部资源/批准证据。主角需客观存在/内在组织/叙述接口三模型各 ≥40 字符，世界三个必需节各 ≥20 字符；初始化占位不可充数。9 个必需资源 ID 均需 active+approved，至少有一个 active 的正式世界系统。输出 `{ready,status:"ready"|"blocked",errors}`；ready 退出 0，blocked 1，参数错误 2。

### 9. governance_check.py

```text
--project-root ROOT
```

只读注册表及其资源、批准证据、`authoring-ruwen-v5/manifests/*.json`、审计账本；仅检查文学账本是否存在及 manifest 是否泄露其名称，不读其中内容。检查 author 字段越权/未激活来源和审计字段白名单；superseded/retired 资源产生 warning。输出 `{valid,errors,warnings}`。合法 0，不合法 1，参数错误 2。

### 10. closure_audit.py

```text
--file PATH --resource-id ID --resource-version VERSION --manual-review JSON_FILE [--output PATH]
```

读取资源与绑定其 ID/绝对路径/版本/哈希的人工复核。六类检查为 `route,fulfillment,closed_mapping,example_anchor,semantic_density,source_proximity`。人工复核 reviewed_by 只能 user 或 biaoxian-shejishi，六项 checks 必须全 pass。正则无发现仍不等于自动批准；必须同时人工复核有效。

输出 `{path,sha256,resource_id,resource_version,manual_review,pass,decision,findings:[{category,count,samples}]}`，decision 为 candidate_allowed 或 remain_proposed。可选写 output，**不会激活资源或修改注册表**。通过 0，失败 1，参数错误 2；IO/JSON 异常通常 1。

### 11. init_project.py

```text
--project-root ROOT --project-id ID
```

读取 `PLUGIN/assets/project-template/`，目标必须不存在或为空，ID 匹配 `[a-z0-9][a-z0-9-]{2,63}`。在目标同级临时目录复制模板，再设置每条注册资源 scope.project 和原始字节 source_sha256，修改 manifest 的 context_scope.project，写一条脚手架技术审计，最后 rename 到目标。

注意不是对所有文件做通用字符串替换；它按 JSON 字段更新占位值。不等于正式写作 state init，也不激活候选资源。输出 `{status:"created",project_root,project_id,readiness:"blocked_until_user_approval"}`。成功 0，显式拒绝/未捕获异常 1，参数错误 2。

### 12. migrate_v4_1_preview.py

```text
--project-root ROOT [--output PATH]
```

遍历旧项目文件（排除 `authoring-v4-1/packets/` 和 __pycache__），读取原始字节计算哈希，映射 characters/world/continuity/outlines/author-voice 等旧路径。输出 `{source_root,mode:"read_only_preview",files:[{source_path,source_sha256,type,proposed_path,note,action:"preview_only"}],warnings}`。

默认只打印。output 必须在源项目外，独占创建，不覆盖已有文件；不移动或改写任何源项目内容。成功 0，显式拒绝/未捕获异常 1，参数错误 2。**本次仅盘点，移植在 P7 之后。**

## 岗位输入、输出与禁止事项

岗位文件在 `PLUGIN/skills/<入口>/references/roles/<id>.md`。前六个属于 ruwen-gushi-gousi，后六个属于 ruwen-zhangjie-xiezuo。12 份均已完整读取。以下是文件全部要点的接口化整理；角色文件很短，不能只用计划表格替代共享契约和相关参考规范。

| ID / 岗位 | 允许的输入与输出 | 禁止事项与必要门槛 |
|---|---|---|
| chuangyi-xietiaoyuan / 创意协调员 | 当前用户表达、最少项目状态 → 理解预览；确认后一次性干净委托，保留创意价值与共存压力 | 不直接改项目；剥离例子、抱怨和完整路线；原话与委托不同时交给下游 |
| xiangmu-zhiliyuan / 项目治理员 | 获准治理委托、相关资料 → 职责/唯一所有者/作用域/版本/状态/替代/权限/审批/冲突预览；批准后资料+注册表+技术审计 | 只定位矛盾让用户决定，不统一人物认识差和开放未知，不给作者治理解释 |
| waibu-zhishi-guwen / 外部知识顾问 | 项目问题与获准资料 → 学习计划或调查证据、不确定性、机会、冲突、归属和作用域 | 没有明确问题先批准学习计划；不写 Canon、大纲、项目声音和作者规则 |
| biaoxian-shejishi / 表现设计师 | 已批准研究和项目正文 → 项目文字能力，只描述选择关系 | 删除来源名、引文、固定意象、场景答案和封闭映射；不从样本缺失反推禁令；闭合审计+隔离非正典试写+用户阅读后才能激活 |
| gushi-gousishi / 故事构思师 | 干净创意委托、相关已批准资料 → 具体多章故事的人物/活动/事件/因果/后果，保持实现/误解/认识开放 | 不用通用戏剧模板替用户判断，不预写对白、意象、固定神态、读者感受和最终心理答案 |
| zhangjie-qingjing-bianyiyuan / 章节情境编译员 | 批准故事和有效项目事实 → ≤2200 字符 generation field，选择改变行动/成本/感知/社会含义的世界条件 | 不给作者规划理由、人物答案、固定表现手段、研究来源和检查表 |
| xiaoshuo-zuozhe / 小说作者 | 仅编译后的有界作者资料包、新上下文 → 一章纯正文候选，保存 candidates/ | 不浏览项目、不查来源、不预自检；明确事件与锁定顺序成立；不输出规划/清单/来源解释/辩护，不写正式章节 |
| qinggan-duzhe / 情感读者 | 正文和最少阅读定位 → 具体文本处的注意/期待/误解/断裂/解释感/失去兴趣 | 不看大纲和规则，不提供替换句，不猜作者本意 |
| wenxue-bianji / 文学编辑 | 正文、读者反应、按需单份诊断 → LOCAL_EDIT / RESTAGE / RETURN_CONSTRUCTION，原稿保留和修改记录，私有问题账本 | 局部仅处理已出现的解释/重复/句序/段界/对白措辞；不补剧情桥、不替人物回答、不消除所有含混、不强制润色；同类跨≥2任务出现≥3次才成复发候选，不能自动生成作者禁令 |
| qingjie-heyanyuan / 情节核验员 | 正文与明确锁定的事件/结果/顺序 → 差异定位，失败返回情境编译员 | 不评价文学、不把方向升级硬承诺、不生成补丁句、不要求同等篇幅 |
| xianshi-heyanyuan / 现实核验员 | 正文和当前相关硬设定 → 身份/时空/知识/物理/制度/能力/不可逆 Canon 冲突和资料 ID | 未提及不是错，人物误解不是世界错误，不把规则改写成作者禁令 |
| jiyi-weihuyuan / 记忆维护员 | 仅在用户批准章节后，批准正文和受权限约束资料 → 新事实/状态/失效/作用域/下章状态预览，再次批准后提交 | 不把比喻、推断和角色误解自动当客观 Canon |

`shared/information-contract.md`、`shared/creative-communication-contract.md` 约束输入边界和交接物；SKILL.md 的路由/自律文字用于平台实现调查，不整体作为任何岗位提示词。作者只取 CREATIVE-SOUL 的 AUTHOR_CORE 段。四个文学诊断为按需资源，不能整包加载。

## test_ruwen_v5.py：36 个测试覆盖映射

使用 unittest，setUp 复制最小 5.0 模板到临时项目。make_ready 构造批准证据；prepare_packet 初始化 state、情境和资料包。含 12 进程批准竞争测试和子进程 CLI 检查；不是 36 个纯静态断言。通过命令 `pnpm test:upstream`，2026-11-06 原始提交字节基线结果 36/36。

| # | 测试方法 | 具体覆盖 |
|---|---|---|
| 1 | test_project_blocks_incomplete_protagonist | 未完成人物三模型时不能就绪 |
| 2 | test_ready_project_and_scope_selection | 完整批准项目就绪；作者可选声音/POV，不可选主角全档 |
| 3 | test_closure_audit_rejects_examples_and_mapping | 例子锚定、封闭映射被审计拒绝 |
| 4 | test_closure_audit_rejects_sample_derived_emotion_ban | 由样本推导的情绪命名禁令被拒绝 |
| 5 | test_author_packet_uses_only_active_bounded_sources | 编译有界 active 来源，不泄露人物全档/研究路径，≤8000 |
| 6 | test_approval_promotion_and_memory_gate | 候选批准→正式推广→待记忆合并；第二次批准前不能继续注册情境 |
| 7 | test_existing_chapter_replacement_requires_hash_and_archive | 替换必须旧哈希且保存旧正文快照 |
| 8 | test_generation_field_contamination_is_rejected | 有序/项目符号情节清单拒绝 |
| 9 | test_migration_preview_is_read_only | 旧声音路径分类不改变源哈希（库函数覆盖） |
| 10 | test_retired_author_resource_is_rejected | retired POV 不再被作者选择 |
| 11 | test_problem_ledger_requires_cross_task_recurrence | 同类第三次且跨两任务才标复发 |
| 12 | test_governance_detects_manifest_leak | manifest 用研究充当声音时治理检查拒绝 |
| 13 | test_handoff_rejects_raw_and_translated_input_together | 委托混入原话字段拒绝 |
| 14 | test_consultant_cannot_run_before_learning_plan_approval | 无独立批准引用不能执行调查委托 |
| 15 | test_arc_scoped_expression_retires_cleanly | 弧/场景作用域表现能力可命中，退役后消失 |
| 16 | test_author_core_budget_and_no_old_role_names | 作者核心≤420，岗位生产材料无旧英文角色名 |
| 17 | test_manifest_cannot_self_declare_a_different_scope | manifest 不能自行改变已登记章节作用域 |
| 18 | test_rogue_packet_and_tampered_meta_are_rejected | 未登记伪造 packet 与 meta schema 篡改被拒绝 |
| 19 | test_silent_floor_and_protected_promotion_target | 候选元语言不能批准；不能推广覆盖世界资料 |
| 20 | test_candidate_approval_event_cannot_be_reused | 已批准消费事件不能再次验证/使用 |
| 21 | test_reconcile_rejects_research_as_story_source | 研究不能伪装成 active 故事跟踪来源 |
| 22 | test_reconcile_without_pending_memory_is_valid | 无待记忆时可 reconcile 并失效情境 |
| 23 | test_placeholder_content_cannot_make_project_ready | 占位文本不能冒充完整人物档案 |
| 24 | test_active_expression_cannot_refresh_without_new_evidence | active 表现不能通过 refresh-hash 绕过新证据 |
| 25 | test_expression_evidence_cannot_be_reused_for_another_resource | 审计证据不能复用于另一资源 |
| 26 | test_generic_nested_input_key_is_rejected_from_handoff | 嵌套通用 content 字段污染同样拒绝 |
| 27 | test_handoff_values_are_typed_and_raw_wording_is_checked_in_memory | payload 类型及字符串/数组中的原话重合检查 |
| 28 | test_handoff_approval_is_consumed_once | 交接可验证一次，消费后再次执行被拒绝 |
| 29 | test_approval_event_validation_rejects_empty_identity_and_time | 空 ID 和无效批准时间拒绝 |
| 30 | test_approval_consumption_is_atomic_across_processes | 12 个进程竞争同一批准，恰好一个成功 |
| 31 | test_failed_resource_commit_does_not_burn_approval | 模拟注册表写失败，批准 reservation 回滚 |
| 32 | test_research_directory_cannot_masquerade_as_world_resource | 研究路径声明 world 职责也不允许 |
| 33 | test_silent_floor_rejects_synonymous_compliance_language | 多组同义履约/出处说明元语言拒绝 |
| 34 | test_migration_preview_cannot_write_inside_source | CLI 禁止将迁移预览写回源目录 |
| 35 | test_project_id_injection_is_rejected | 非法项目 ID 拒绝且不创建目标 |
| 36 | test_project_initialization_is_atomic_and_valid | CLI 初始化成功、注册表合法、project scope 一致 |

这些测试并不代替 P1 要求的所有差分场景或平台 I1–I13 测试：例如完整失败分支、所有跨文件回滚和全岗位上下文隔离仍需新增验证。

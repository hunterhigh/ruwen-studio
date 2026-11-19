# 块 E · 作者修改候选稿

## 做了什么

- 以块 T 已合并的 `main` `38d9ca1` 为基线，核对借鉴设计 v0.2 的第 0、1、4 节和块 E。
- 1. 作者稿、原稿及编辑候选稿在 `authoring-ruwen-v5/candidates/<runId>-{author,original,candidate}.md`。路径和 `candidateSha256` 保存在 `run.json`（`packages/pipeline/src/index.ts:72–92,500,521,566,630`）。正文及原始字节哈希由 `project_files.content/sha256` 持久化（`packages/db/src/schema.ts:65–78`）。入队校验最新保存的哈希，批准事务重新读取候选文件核验（`apps/worker/src/service.ts:305–333`，`packages/pipeline/src/index.ts:685–691`）。
- 2. `approveCandidate` 根据 `run.paths.candidate` 创建 `candidate_approve`。 `recordApproved` 校验路径及事件哈希并消费一次，`promoteApproved` 用 `pending_approved_candidate.path` 晋升。可在保存新版本时事务性更新候选引用及哈希（`packages/pipeline/src/index.ts:704–727`，`packages/core/src/state/index.ts:450–516,520–538`）。
- 3. 新增版本文件的兼容性见下方实测。上游及 core 允许多个 Markdown 候选共存，并能按事件选定特定版本。
- 4. `generateMemoryPreview` 读取晋升后的 `run.target` 并传为 `approved_prose`。岗位再次与正典对照（`packages/pipeline/src/index.ts:736–774`，`packages/agents/src/run-role.ts:118–161`）。
- 5. 作者生成配置为 65,536 token，含思考余量（`config/models.json:51–54`）。候选正文的 silent floor 校验内容，后续岗位的一段文本默认上限为 100,000 Unicode 码点，可用 `RUWEN_MATERIAL_MAX_CHARS` 配置。通用 HTTP JSON 上限为 65,536 字节（`packages/core/src/checks/index.ts:181–186`，`packages/core/src/security/input.ts:11–45`，`config/security.ts:13`，`apps/web/src/server/api.ts:252–257`）。建议候选生成和保存共享现有材料字符上限，为保存路由单设有界请求体。
- 6. 可单独预留和结算。每个运行只有一份预留，每个运行和岗位只有一次角色记录。建议独立重核验任务绑定父章节及候选哈希，仅运行两岗，复用 `quoteRun/reserveRun/settleRole/finishReservation`（`packages/db/src/schema.ts:173,342`，`packages/billing/src/ledger.ts:144–262`）。
- 7. 改版块 3 的 #47 仍开放，改版块 4 未进入 `main`。实施时按设计延后审稿桌界面与版本对比。
- 在 `/api/runs/:runId` 下新增 POST `/candidate/revisions`（返回版本和哈希）、GET `/candidate/revisions/:version`（返回正文）、POST `/reverify`（返回任务 ID）。运行记录保留作者、编辑及各用户版本。批准绑定最新正文哈希，候选生成与保存共享材料上限。迁移 0205 新增平台追加式审计，项目账本写白名单摘要。[ADR-019](../../decisions/ADR-019-candidate-revision-audit-and-reverification.md)
- 独立重核验任务按候选版本和哈希绑定，分开预留与结算两个岗位的用量。通过后继续等批准，明确失败按 I11 退回章节情境编译。
- 改动覆盖 `packages/pipeline` 版本和核验编排、`apps/worker` 队列和审计、`packages/db` 迁移、`packages/billing` 预留档及 `apps/web` HTTP 路由、限流和测试。

## 测试结果

- 在临时项目中保留作者稿及编辑稿，另外写入 `chapter-001-user-v2.md`。Python `story_state check`、`compile_author_packet check`、`governance_check`、`closure_audit` 均退出 0，core 的 `story-state check`、`governance-check`、`closure-audit` 也均退出 0。
- 使用新版候选创建批准事件并走 `recordApproved/promoteApproved`。正典文件哈希与新版一致，旧版哈希保持原样。
- 用包含 R1-7 六项详情字段的审计事件验证。core `validateAudit` 返回「审计事件字段必须与白名单完全一致」，上游 `audit_ledger` 退出 1 并给出相同错误。
- 本地 `pnpm lint`、`pnpm typecheck` 通过。`pnpm test` 通过 86 个文件、756 项。`pnpm test:e2e` 通过 33 项，按配置跳过两项旧改版的可选截图归档。浏览器端到端通过实际 API 验证保存、核验基准过期与新版批准流程。

## 未完成与风险

- 修改稿面、核验过期标记与版本对比按前端前置条件进入 OQ-029，本块交付后端与 API。

## 需要人类决定的事

- 两项预检调整已经确认。PR 等人类确认合并。

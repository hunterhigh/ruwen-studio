# AGENTS.md — Ruwen Studio

本仓库把如文写作系统（`vendor/ruwen`，上游 hunterhigh/ruwen-writing-system）做成多用户网页产品。

**开始任何工作前，完整阅读 `docs/PLAN.md`。** 它是本仓库的唯一执行计划。

## 硬规则

- 按 `docs/PLAN.md` 第12节与ADR-008执行：OQ-017 → P5网页 → P6计费 → P7 staging → P3真实模型上线前闸门 → 公开上线。当前不配置模型key、不调用真实模型；每阶段完成后写报告并停下确认，P5完成后供人类在预览环境试用。P3未通过可开发和staging，但生产仅限邀请码注册且禁止真实收费。
- 第 2 节的不变量（I1–I13）不得削弱；与实现冲突时记入 `docs/OPEN_QUESTIONS.md` 并停下。
- 永远不修改 `vendor/ruwen/`。
- 不给任何模型岗位 bash、代码执行或任意文件访问能力；岗位工具只能操作当前项目、受注册表 `readers` 约束。
- 编排（岗位顺序、批准门）只写在 `packages/pipeline` 的代码里，不交给模型决定。
- 测试使用 pi-ai 的 faux provider；真实模型调用只在带 `REAL_MODEL=1` 的测试或手动验证中出现。
- pi 的 API 以已安装版本（1.5.0）的类型声明为准，而不是计划里的示意代码。
- 偏离计划的技术决定写成 `docs/decisions/ADR-NNN-*.md`。
- 一个任务一次提交；提交前 `pnpm lint && pnpm typecheck && pnpm test` 全绿。
- 不提交任何密钥。

## 常用命令

```bash
pnpm install
pnpm test                 # 单元 + 差分 + 契约测试（差分测试需要 python3 ≥ 3.11）
pnpm --filter cli dev chapter run --project fixtures/demo-project --chapter 1 --faux
pnpm --filter web dev
```

## 当前并行边界（2026-11-09）

- 另一个线程在`feat/backend-parallel`负责`.github/`、`packages/pipeline/src/ideation/`、`packages/billing`、构思侧worker任务及v4.1迁移；本线程不得修改这些部分。
- 构思页面依据对方推送的`docs/contracts/ideation-service.md`接入；契约未到先做章节页面，不猜造服务接口。P6本线程只做计费界面和接入，账本、支付适配器、webhook由对方实现。
- 新的大块工作开始前先拉取`origin/main`；共享`apps/worker/src/service.ts`和`packages/agents`只做增量改动，避免覆盖对方工作。
- P3前：生产注册仅邀请码，真实收费开关默认关闭；不得因开发阶段使用faux或record/replay而视为闸门通过。

## P5安全要求（2026-11-09人类补充）

- 人类的`docs/security/SECURITY-DESIGN.md`已合并；修改P5前阅读该文档，按正式编号核对：S1-1渲染/CSP，S1-2归属，S1-3 CSRF/会话/限流，S1-4风控及审计；CSP按3.3第4条。S1-4本线程负责界面和网页管理访问审计，冻结执行由并行线程实现，未接入时必须如实标注。
- 用户与模型内容只通过统一SafeMarkdown组件显示：不允许原始HTML或图片，只允许HTTPS链接并加noopener noreferrer nofollow；lint禁止原始HTML注入。
- HTTPS入口设置CSP与安全响应头。所有资源ID接口、SSE与导出统一requireOwnership，逐路由执行A→B返回404测试；新增路由漏测须使pnpm test/CI失败。
- 所有应用状态变更校验CSRF；Cookie必须HttpOnly、Secure、SameSite=Lax；登录按IP及邮箱限流。P5阶段报告单列安全自查。

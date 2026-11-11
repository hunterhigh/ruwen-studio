# AGENTS.md — Ruwen Studio

本仓库把如文写作系统（`vendor/ruwen`，上游 hunterhigh/ruwen-writing-system）做成多用户网页产品。

**开始任何工作前，完整阅读 `docs/PLAN.md`。** 产品计划以上游和该计划为准；执行流程以本文件 2026-11-11 的人类调整为准，替代 PLAN 中相冲突的每提交全量测试、每批停等与旧合并方式。

## 硬规则

- 按 `docs/PLAN.md` 第12节与ADR-008保留 P5 人类试用、P3 真实模型上线前验收与生产上线授权。当前不配置模型 key、不调用真实模型；P3 未通过可开发和 staging，但生产仅限邀请码注册且禁止真实收费。已授权工作每大项报告后继续，只有契约变更、计费规则、偏离上游或需要人类决定时停等。
- 第 2 节的不变量（I1–I13）不得削弱；与实现冲突时记入 `docs/OPEN_QUESTIONS.md` 并停下。
- 永远不修改 `vendor/ruwen/`。
- 不给任何模型岗位 bash、代码执行或任意文件访问能力；岗位工具只能操作当前项目、受注册表 `readers` 约束。
- 编排（岗位顺序、批准门）只写在 `packages/pipeline` 的代码里，不交给模型决定。
- 测试使用 pi-ai 的 faux provider；真实模型调用只在带 `REAL_MODEL=1` 的测试或手动验证中出现。
- pi 的 API 以已安装版本（1.5.0）的类型声明为准，而不是计划里的示意代码。
- ADR 仅用于真正的设计取舍，不重复契约或设计文档已有内容。
- 一个任务一次提交；每次提交跑 lint/typecheck 与受影响包测试（`pnpm --filter <包> test`）。没有包级脚本时从根目录用 `pnpm test <包目录>` 限定同一范围，不把缺失脚本当作测试通过。
- 不提交任何密钥。

## 测试、报告与合并（2026-11-11 人类调整）

- 不在每次提交重复全仓测试；开 PR 和 CI 时跑全量（含 Postgres 集成、强杀恢复、浏览器）。CI 分为 fast（lint/typecheck/单元）和 full 两个 job，合并前两项都必须通过，不能以 fast 代替 full。
- 强杀恢复测试只针对扣费、批准消费、正典提交三类边界，其他新功能不再新增。现有越权、批准哈希、账本、上游不变量测试照常要求，不删断言来过 CI。
- 提示词防泄露维持现状，不再追加新机制或新测试；上游提示词本身已公开。其他岗位隔离、批准门、租户与产品安全规则继续有效。
- 每批报告不超过 30 行，固定四部分：做了什么 / 测试结果 / 未完成与风险 / 需要人类决定的事。
- 两个线程都通过 PR 合并，不直接推送 main，不 force push。已有公开分支用 merge origin/main 同步，避免改写历史；叠加 PR 的前序合并后，将 base 改为 main 再同步。
- PR 对最新 main 的 fast/full CI 全绿后，由负责线程自行合并。只有涉及契约变更、计费规则、偏离上游规则或需要人类决策的 PR，才等人类确认；明确授权合并的既有 PR 按授权执行。

## 常用命令

```bash
pnpm install
pnpm test                 # 单元 + 差分 + 契约测试（差分测试需要 python3 ≥ 3.11）
pnpm --filter cli dev chapter run --project fixtures/demo-project --chapter 1 --faux
pnpm --filter web dev
```

## 当前并行边界（2026-11-11）

- A 主线程负责 apps/web、计费核心与风险冻结；B 并行线程负责 .github/、构思后端、协调员录制、红队与 v4.1 迁移。共享 worker/agents 尽量增量修改。AGENTS.md 由 B 线程维护，A 线程只遵守、不修改。
- 构思页面依据对方推送的`docs/contracts/ideation-service.md`接入；契约未到先做章节页面，不猜造服务接口。2026-11-10人类调整：P6计费核心、支付适配器/webhook、账户界面和风险冻结/人工解冻均由本主线程负责；允许在等待构思后端期间先做P6，P5仍不宣称完成。构思后端分4批PR，每批合并后由本线程注册已实现接口、替换对应假数据并补归属/CSRF/SSE测试；未实现路由不提前注册。
- 新的大块工作开始前先拉取`origin/main`；共享`apps/worker/src/service.ts`和`packages/agents`只做增量改动，避免覆盖对方工作。
- P3前：生产注册仅邀请码，真实收费开关默认关闭；不得因开发阶段使用faux或record/replay而视为闸门通过。

## P5安全要求（2026-11-09人类补充）

- 人类的`docs/security/SECURITY-DESIGN.md`已合并；修改P5前阅读该文档，按正式编号核对：S1-1渲染/CSP，S1-2归属，S1-3 CSRF/会话/限流，S1-4风控及审计；CSP按3.3第4条。S1-4按2026-11-10最新分工，由本线程负责界面、风险冻结/人工解冻及管理审计。
- 用户与模型内容只通过统一SafeMarkdown组件显示：不允许原始HTML或图片，只允许HTTPS链接并加noopener noreferrer nofollow；lint禁止原始HTML注入。
- HTTPS入口设置CSP与安全响应头。所有资源ID接口、SSE与导出统一requireOwnership，逐路由执行A→B返回404测试；新增路由漏测须使pnpm test/CI失败。
- 所有应用状态变更校验CSRF；Cookie必须HttpOnly、Secure、SameSite=Lax；登录按IP及邮箱限流。P5阶段报告单列安全自查。

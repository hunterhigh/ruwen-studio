# AGENTS.md — Ruwen Studio

本仓库把如文写作系统（`vendor/ruwen`，上游 hunterhigh/ruwen-writing-system）做成多用户网页产品。

**开始任何工作前，完整阅读 `docs/PLAN.md`。** 它是本仓库的唯一执行计划。

## 硬规则

- 按 `docs/PLAN.md` 第 12 节的阶段顺序执行；P0、P3、P5 结束后停下，写阶段报告，等待人类确认。
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

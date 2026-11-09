# 并行开发报告：Linux CI

日期：2026-11-09。分支：`feat/backend-parallel`。

## 交付

新增 `.github/workflows/ci.yml`，在 push、pull_request 或手动触发时运行 Ubuntu 24.04 检查；Actions 固定到完整提交 SHA。使用最低支持版本 Node 22.19.0、packageManager 指定的 pnpm 11.25.0、Python 3.11 和带健康检查的 Postgres 18 service。

checkout 不初始化子模块；独立命令只初始化固定版本 `vendor/ruwen`，显式关闭递归。依赖按 lockfile 安装，随后执行 `pnpm lint && pnpm typecheck && pnpm test`。测试通过现有 TEST_DATABASE_URL 接口连接 ruwen_test，由既有 globalSetup 执行迁移；不另设迁移脚本或内嵌数据库。REAL_MODEL=0、MODEL_MODE=faux，不配置模型或支付密钥。

只修改 CI 和本报告；不修改 apps/web、vendor、岗位提示词或 I1–I13。保留全部隔离、批准、Python 字节差分和 worker 强杀恢复测试。CI 用只读仓库权限，同一 Git 引用的新提交取消过期检查，push 与 PR 使用不同引用、不会互相取消，作业上限 30 分钟。

## 验证

工作流通过 actionlint 1.7.12 静态检查。Linux 结果以 GitHub Actions 实际运行为准，不能用 Windows 本地结果代替。

本地新 worktree 的上游子模块最初继承 Windows core.autocrlf=true，导致 git archive 导出的模板换行与字节快照不一致；按原 checkout 的既有配置，将该子模块的本地 Git 配置设为 core.autocrlf=false 后，10 项严格差分全部通过。此设置只影响本地 Git 配置，未改上游源码或模板。Windows 默认双文件并行完整运行出现 3 项文件系统/CLI 超时（303/306 通过）；保留原时限与断言，使用 --maxWorkers=1 验证完整测试，CI 仍执行未加参数的 pnpm test。

本地 lint、typecheck 全绿；串行完整测试 25 个文件、306 项全部通过（403.74 秒），内含上游原始 Python 36 项回归。已 rebase 到 origin/main 的 773324e；未修改默认测试配置。

GitHub Actions Linux 实跑全绿：[运行 42580935865](https://github.com/hunterhigh/ruwen-studio/actions/runs/42580935865)。Ubuntu 24.04、Node 22.19.0、Python 3.11、Postgres 18 service 上，原样执行 pnpm lint && pnpm typecheck && pnpm test；25 个文件、306 项测试全部通过，Vitest 耗时 172.22 秒。子模块初始化步骤、锁定依赖安装及全部检查均成功；未使用递归初始化或任何真实模型密钥。

PR 首次完整复跑同样成功。验收时发现共用 branch 并发组会取消重复 push 检查，使 PR 被标为不稳定；最终按 github.ref 分组，保留同引用取消过期运行，并让 push 与 PR 各自完成。

## 停点

本项交付后等待人类合并 PR 并确认，才开始构思侧后端编排；未实施后续三项。

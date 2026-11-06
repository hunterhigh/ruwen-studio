# 如文工作室 · Ruwen Studio

将如文 5.0 写作系统做成多用户、可部署和可计费的网页产品。实施范围和验收以 [docs/PLAN.md](docs/PLAN.md) 为准。

P0 已经人工确认。P1领域核心与P2的12岗位、章节流程、本地CLI已实现，当前进入P3真实模型验证；尚无可使用的网页或付费账户。

## 本地验证

需要 Node ≥22.19、pnpm 11.25.0、Python ≥3.11 和 Git。从远程复制本项目时先获取上游，但不要递归初始化其私有子模块：

```sh
git -c core.autocrlf=false submodule update --init vendor/ruwen
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm test` 同时运行 pi faux、核心移植、文件系统契约、不变量、严格差分和上游 36 个原始 Python 测试。无需 API key，不调用真实模型或外部付费服务。可用 `PYTHON_BIN` 选择测试用 Python 可执行文件（例如 Linux 的 python3）。单独运行上游测试用 `pnpm test:upstream`；该命令默认使用 python。产品核心运行时不需要 Python 或 Git。

核心 CLI 示例（目标目录需不存在或为空）：

```sh
pnpm core init-project --project-root ./my-novel --project-id my-novel
pnpm core resource-registry validate --project-root ./my-novel
pnpm core project-readiness --project-root ./my-novel
```

新项目仍是待批准脚手架，readiness 返回 blocked 是正常状态。CLI 支持全部 11 个本阶段移植脚本的命令与参数；v4.1 目录迁移仍在后续范围。核心细节和已验证边界见 [P1 报告](docs/reports/phase-1.md)。

已就绪的5.0项目可以运行章节CLI：

```sh
pnpm --filter cli dev chapter run --project ./my-novel --chapter 1 --faux
pnpm --filter cli dev chapter resume --project ./my-novel --run <运行ID> --faux
pnpm --filter cli dev chapter status --project ./my-novel --run <运行ID>
pnpm --filter cli dev chapter cancel --project ./my-novel --run <运行ID>
```

批准候选稿和记忆预览各需输入一次`APPROVE`。回车或EOF保留待批准状态；`resume`重新展示内容和批准提示。真实模型需去掉`--faux`，在本项目`.env`配置`REAL_MODEL=1`和`ANTHROPIC_API_KEY`；密钥不得放入聊天或Git。P2已验证范围见[P2报告](docs/reports/phase-2.md)，当前没有网页入口。

pnpm 11 的 `allowBuilds` 显式禁用三个依赖的安装脚本。当前检查可直接使用已发布的可选二进制；新增功能确实需要脚本时再按依赖逐项核验。

上游固定在 `v5.0.0` / `9835470fa07b216c85602915a38063b0d7c937b5`。Windows 自动换行可能影响其模板批准哈希，基线测试从固定 Git 提交导出原始字节，在临时副本运行，不改变 vendor。升级上游需重新进行接口盘点和所有基线验证。

## 目录职责

| 目录 | 阶段与用途 |
|---|---|
| packages/core | P1：领域逻辑、ProjectFS/LocalDirFS、预览提交、CLI 与回归测试 |
| packages/agents | P0 spike；P2 已实现提示词、12岗位、隔离工具与模型适配 |
| packages/pipeline | P2：已实现本地章节状态机、双批准与取消 |
| packages/db / packages/billing | P4 持久化 / P6 计费；当前仅骨架 |
| apps/cli / apps/worker / apps/web | P2 CLI已实现；P4 worker / P5 网页仍为骨架 |
| config | 经过静态目录核验的暂定模型路由、目录快照 |
| fixtures | P3手写5.0演示项目；已验证可复制和faux链，真实验证待API密钥 |
| docs | 计划、接口盘点、技术决定和阶段报告 |
| scripts | 开发验证工具，不属于产品运行时 |
| vendor/ruwen | 只读的固定版本上游子模块 |

模型默认值仅作为可替换起点；包目录中存在不代表账户有权限或服务商仍提供。P3 用真实 API 实测后再确定路由与价格。

演示源在`fixtures/demo-project`。推荐先用`pnpm demo:create .local/my-demo`生成可修改副本，再以`--project .local/my-demo`运行章节CLI。真实三次验证入口为`pnpm benchmark:real`，当前准备与阻塞见[P3记录](docs/reports/phase-3.md)。

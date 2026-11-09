# 如文工作室 · Ruwen Studio

将如文 5.0 写作系统做成多用户、可部署和可计费的网页产品。实施范围和验收以 [docs/PLAN.md](docs/PLAN.md) 为准。

P0已经人工确认。P1/P2和P4数据库、后台worker、任务恢复与ZIP导入导出已实现。按2026-11-09用户要求，P3真实模型验证延期，暂不配置API；当前尚无可使用的网页或付费账户（P5/P6）。

## 本地验证

需要 Node ≥22.19、pnpm 11.25.0、Python ≥3.11 和 Git。从远程复制本项目时先获取上游，但不要递归初始化其私有子模块：

```sh
git -c core.autocrlf=false submodule update --init vendor/ruwen
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
```

`pnpm test`运行pi faux、领域/文件系统契约、严格差分、上游36项Python基线和真实Postgres/pg-boss测试。无需模型API key；默认启动临时Postgres，也可用`TEST_DATABASE_URL`指定测试库。可用`PYTHON_BIN`选择Python（例如Linux的python3）。单独跑上游用`pnpm test:upstream`；产品核心运行时不需要Python或Git。数据库环境与恢复说明见[持久化使用说明](docs/persistence.md)。

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

pnpm 11的`allowBuilds`保留三个原依赖安装脚本禁用；对已审阅的embedded-postgres平台包只启用重建所需符号链接的安装脚本。没有改变机器全局配置或创建操作系统用户。

上游固定在 `v5.0.0` / `9835470fa07b216c85602915a38063b0d7c937b5`。Windows 自动换行可能影响其模板批准哈希，基线测试从固定 Git 提交导出原始字节，在临时副本运行，不改变 vendor。升级上游需重新进行接口盘点和所有基线验证。

## 目录职责

| 目录 | 阶段与用途 |
|---|---|
| packages/core | P1：领域逻辑、ProjectFS/LocalDirFS、预览提交、CLI 与回归测试 |
| packages/agents | P0 spike；P2 已实现提示词、12岗位、隔离工具与模型适配 |
| packages/pipeline | 章节状态机、双批准、取消和持久运行恢复接口 |
| packages/db | P4：Drizzle/schema迁移、PostgresFS、文件历史与运行/费用事实 |
| packages/billing | P6计费；仍为骨架 |
| apps/cli / apps/worker / apps/web | CLI和pg-boss worker已实现；P5网页仍为骨架 |
| config | 经过静态目录核验的暂定模型路由、目录快照 |
| fixtures | P3手写5.0演示项目；已验证可复制和faux链，真实验证待API密钥 |
| docs | 计划、接口盘点、技术决定和阶段报告 |
| scripts | 开发验证工具，不属于产品运行时 |
| vendor/ruwen | 只读的固定版本上游子模块 |

模型默认值仅作为可替换起点；包目录中存在不代表账户有权限或服务商仍提供。P3 用真实 API 实测后再确定路由与价格。

演示源在`fixtures/demo-project`。推荐先用`pnpm demo:create .local/my-demo`生成可修改副本，再以`--project .local/my-demo`运行章节CLI。真实三次验证入口为`pnpm benchmark:real`，当前准备与阻塞见[P3记录](docs/reports/phase-3.md)。

无需模型API的数据库演示：`pnpm db:dev`启动本机Postgres，按[持久化使用说明](docs/persistence.md)设置数据库地址并启动`pnpm --filter worker dev`，用`pnpm demo:db`创建演示项目和章节任务。P4的213项检查与恢复边界见[P4报告](docs/reports/phase-4.md)。

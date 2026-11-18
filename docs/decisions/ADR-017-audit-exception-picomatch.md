# ADR-017：picomatch 单条审计例外

状态：接受（2026-11-18，人类明确批准块 0.3 的条件性例外路径）。到期日：**2026-12-18**。

## 背景与决定

块 0.2 的文档 PR #42 被生产依赖审计阻塞。调查时只有一条高危：**GHSA-fc5q-39xc-vjpf / CVE-2026-112366**，picomatch 受影响范围为 `<=4.0.7`，当前安装 4.0.7。npm 最新版仍为 4.0.7，公告与审计均无已发布修复版本；`pnpm view picomatch versions --json` 最后五项为 3.0.2、4.0.4、4.0.5、4.0.6、4.0.7。

该漏洞需要攻击者控制传入 picomatch 的重复 extglob 模式，导致正则回溯耗尽事件循环。当前应用输入链没有该模式入口，按人类已批准的条件，仅对这个 GHSA 设置有期限的审计例外。**这不是库漏洞已修复，也不是所有 glob 使用都安全的结论。**

pnpm 固定为 11.25.0；使用该版本 `pnpm audit --ignore GHSA-fc5q-39xc-vjpf` 实际生成且验证生效的 `pnpm-workspace.yaml` → `auditConfig.ignoreGhsas`。不使用批量忽略、`ignore-unfixable` 或 `ignore-registry-errors`，不降低 CI 的 `--audit-level high`，不修改版本或 lockfile。**任何新的高危漏洞仍然阻断合并。**

## 引入路径

`pnpm why picomatch --prod` 与 `pnpm -r why picomatch --prod` 结果相同。picomatch 4.0.7 因 Web 的 better-auth 1.7.18 → Vitest 4.1.12 可选 peer 依赖链进入生产审计；Vite 7.3.7、@vitest/mocker 4.1.12、tinyglobby 0.2.17、fdir 6.5.0 位于其中。审计列出的全部 11 条路径如下：

```text
apps__web>better-auth>vitest>@vitest/mocker>vite>fdir>picomatch
apps__web>better-auth>vitest>@vitest/mocker>vite>picomatch
apps__web>better-auth>vitest>@vitest/mocker>vite>tinyglobby>fdir>picomatch
apps__web>better-auth>vitest>@vitest/mocker>vite>tinyglobby>picomatch
apps__web>better-auth>vitest>picomatch
apps__web>better-auth>vitest>tinyglobby>fdir>picomatch
apps__web>better-auth>vitest>tinyglobby>picomatch
apps__web>better-auth>vitest>vite>fdir>picomatch
apps__web>better-auth>vitest>vite>picomatch
apps__web>better-auth>vitest>vite>tinyglobby>fdir>picomatch
apps__web>better-auth>vitest>vite>tinyglobby>picomatch
```

## 当前输入链核查（块 0.3 第 1d 步）

扫描 `apps/` 与 `packages/` 下 260 个已跟踪 TS/JS 源文件，picomatch、micromatch、tinyglobby、fast-glob、chokidar 的直接使用均为 0；另检索了 glob/文件监视调用。以下调用点没有把不可信输入作为 glob 模式：

| 输入与调用点 | 当前行为与结论 |
|---|---|
| HTTP 请求：[api.ts](../../apps/web/src/server/api.ts)，项目导入及 `/files` 分支 | 导入调用 `importProjectZip`；文件查询调用 `owned.fs.path/sha256/readText`，无路径时 `list()`，均是具体路径或固定枚举操作。 |
| ZIP 路径：[archive.ts](../../packages/core/src/archive.ts)，`logicalPath`、`importProjectZip` | yauzl 逐项读取条目，校验路径后 `createExclusive`；条目名是具体文件名，不送入 glob。 |
| 本地项目文件：[local-dir-fs.ts](../../packages/core/src/fs/local-dir-fs.ts)，`list` | 规范化目录前缀，使用 `lstat/readdir` 递归枚举，不做 glob 匹配。 |
| 数据库项目文件：[postgres-fs.ts](../../packages/db/src/postgres-fs.ts)，`list` | 参数化 SQL 对路径做等值及 `left(...)` 前缀匹配，不解释 glob 元字符。 |
| 模型输出：[tools/index.ts](../../packages/agents/src/tools/index.ts)，`readAuthorizedResource`、`roleTools` | 资源 ID 经注册表和 readers 校验后按具体路径读取；诊断名匹配固定白名单。没有任意 glob 工具。 |
| 认证：[auth.ts](../../apps/web/src/server/auth.ts)，`createWebAuth` | 仅使用 `better-auth/minimal`、magic-link 等运行入口；没有导入 `better-auth/test-utils`。已安装 Better Auth 的 Vitest 导入位于该测试入口，其自有 wildcard 工具不调用 picomatch。 |

结论是对当前应用路径的可达性评估，不能推广为该依赖可接受用户模式。若后续新增 glob 库、可配置 glob 模式，或把 HTTP/项目文本/ZIP 路径/模型输出送入模式参数，必须先重新评估；本例外不能作为该新路径的批准依据。

## 到期前处理与替代方案

- 在 **2026-12-18 前**复查官方公告、npm 修复版本及上述输入链；对应待办为 OQ-023。
- 一旦发布兼容修复版本，固定到修复版、更新 lockfile，删除该 GHSA 例外；运行 `pnpm install --frozen-lockfile`、生产高危审计、lint、typecheck、test 与 fast/full CI 后通过独立 PR 合并。
- 若到期仍无修复，例外不自动续期，须重新评估并获得人类批准。pnpm 的 GHSA 列表本身不执行到期日，维护者须按待办复查。
- 未选：伪造不存在的修复版本；忽略全部不可修复漏洞；降低审计级别；关闭生产审计；未经验证移除 Better Auth 的 peer 链。保留当前依赖解析，避免在本块扩大运行时变化。

## 依据

- [GitHub 官方公告 GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)（2026-11-18 核对，含 CVE、影响范围及无修复版本）。
- [pnpm audit 官方说明](https://pnpm.io/cli/audit)，以本机固定版本 11.25.0 的实际命令与结果验证配置。
- 修改前执行的 `pnpm audit --prod --audit-level high`、上述两条 `why`、`pnpm view picomatch versions --json`，以及上述应用/已安装依赖源码检查。

## 调查原始输出（修改配置前）

`pnpm audit --prod --audit-level high`，退出码 1：

```text
┌─────────────────────┬────────────────────────────────────────────────────────┐
│ high                │ picomatch vulnerable to ReDoS through single-branch    │
│                     │ repeated extglobs                                      │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Package             │ picomatch                                              │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Vulnerable versions │ <=4.0.7                                                │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Patched versions    │ None                                                   │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ Paths               │ apps__web>better-auth>vitest>@vitest/                  │
│                     │ mocker>vite>fdir>picomatch                             │
│                     │                                                        │
│                     │ apps__web>better-auth>vitest>@vitest/                  │
│                     │ mocker>vite>picomatch                                  │
│                     │                                                        │
│                     │ apps__web>better-auth>vitest>@vitest/                  │
│                     │ mocker>vite>tinyglobby>fdir>picomatch                  │
│                     │                                                        │
│                     │ ... Found 11 paths, run `pnpm why picomatch` for more  │
│                     │ information                                            │
├─────────────────────┼────────────────────────────────────────────────────────┤
│ More info           │ https://github.com/advisories/GHSA-fc5q-39xc-vjpf      │
└─────────────────────┴────────────────────────────────────────────────────────┘
1 vulnerabilities found
Severity: 1 high
```

`pnpm why picomatch --prod` 与 `pnpm -r why picomatch --prod` 输出一致：

```text
picomatch@4.0.7
├─┬ fdir@6.5.0
│ ├─┬ tinyglobby@0.2.17
│ │ ├─┬ vite@7.3.7
│ │ │ ├─┬ @vitest/mocker@4.1.12
│ │ │ │ └─┬ vitest@4.1.12
│ │ │ │   └─┬ better-auth@1.7.18
│ │ │ │     └── web@0.0.0 (dependencies)
│ │ │ └── vitest@4.1.12 [deduped]
│ │ └── vitest@4.1.12 [deduped]
│ └── vite@7.3.7 [deduped]
├── tinyglobby@0.2.17 [deduped]
├── vite@7.3.7 [deduped]
└── vitest@4.1.12 [deduped]

Found 1 version of picomatch
```

`pnpm view picomatch versions --json` 最后五个版本：

```json
["3.0.2", "4.0.4", "4.0.5", "4.0.6", "4.0.7"]
```

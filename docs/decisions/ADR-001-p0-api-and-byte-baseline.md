# ADR-001：P0 以已安装 pi 接口与上游 Git 原始字节为验证依据

日期：2026-11-06。状态：已实施于 P0 验证；未扩展到 P1/P2 产品代码。

## 背景

计划规定 pi 1.5.0 类型声明优先于示意代码；实际核验发现参数默认会转换类型、工具提前结束按整批计算、faux 返回零费用，且无直接 maxTurns 构造参数。Windows 全局 core.autocrlf=true 还会改变上游模板批准事件的原始字节，导致 36 个原始测试中的 14 个初次失败。

## 决定

1. 三个 pi 包精确固定 1.5.0，npm 可安装，无需源码构建。用显式 createModels + fauxProvider 注册，并向 Agent 注入 models.streamSimple。不使用 pi-coding-agent。
2. 在 spike 验证所有真实语义；P2 应用非转换的 pi-schema compile 校验原始 toolCall.arguments 后才能产生副作用。测试同时保留默认转换行为和严格拒绝行为，不能只测被转换后的参数。
3. `terminate:true` 不充当跳过同批其他工具的保证。P2 需要平台级提交状态保护，使用 finishTurn 有界结束；其完整实现留在 P2。
4. faux usage 用于验证 token/事件采集；faux cost 为零。独立验证 calculateCost 对已配置价格的计算，不把测试估算当真实费用。
5. 上游回归从子模块 HEAD 的 git archive 导出临时副本，保留原始 LF 和批准哈希。代码、模板、测试、注册表哈希均不打补丁。外层 Python 以 -I 启动，内层原测试保留其同目录 import 与子进程环境。
6. 工具链精确固定并提交 pnpm lockfile；使用 pnpm 11 的 allowBuilds 显式拒绝 @google/genai、esbuild、protobufjs 安装脚本。已验证 lint/typecheck/test 不需要运行这些脚本。

## 理由与替代方案

直接放宽上游哈希检查、修订 vendor 测试或在夹具中重算批准哈希会掩盖字节兼容问题，故不用。依赖 Unix/WSL 才能验证会削弱本机可复现性；git archive 可跨平台保持提交字节。使用旧 pi-mono 包会引入无必要的 API 偏离，故不用。

## 后续影响

P1 差分测试须显式控制时间、临时根目录与输出换行，并按原始字节比较产物。Python 文本写入在 Windows 默认 CRLF，TS 不可无意混用；以声明的测试环境和原始脚本行为逐项验证。最终产品导入导出保留字节，不规范化用户文件。生产交易、隔离和审批的 I1–I13 要求不因本决定改变。

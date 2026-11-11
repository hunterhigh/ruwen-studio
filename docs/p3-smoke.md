# P3 冒烟工具

工具强制设置 SDK `maxRetries=0`，禁用没有独立用量凭据的传输重试；岗位纠正重试仍逐请求计量。replay 报告中的费用为原录制用量，不产生新的 provider 费用。

默认命令不需要 key、不调用真实模型，并自动以 record 模式包装 faux：

```sh
pnpm p3:smoke --output .local/p3-smoke/demo
pnpm p3:smoke --mode replay --output .local/p3-smoke/demo
```

输出目录须为新的录制目录；重放显式复用该目录。默认演示项目、独立临时 Postgres，忽略用户 DATABASE_URL，不修改演示源文件、实际项目或 vendor。退出清理数据库；平台私有录制、JSON 报告、完整候选稿保留在输出目录。协调员夹具使用来源引用格式，由固定演示输入重建，不保存原话或完整 context。重放校验相同语义请求，禁止 provider fallback；提示词、canary、模型配置改变后须重新录制。

流程为：一次协调员对话 → 干净通讯门预览 → 工具代表演示用户批准 handoff_execute → 故事构思师 file_patch 预览 → 章节情境编译/批准 → 一章写作及检查 → 工具批准候选稿 → 记忆预览。下游文件预览不自动批准，记忆不提交；候选稿的批准只发生在工具独立项目。所有批准使用现有服务的哈希重算和事务门，不增设旁路。

`--max-usd 5` 是必设的正数费用上限，省略时为 5 美元。每个岗位的每次 provider 请求（包括重试和工具回合）先检查累计已用与在途预留。预留按已安装 SDK 所有费率档的最大 input/cacheRead/cacheWrite、完整 contextWindow 与请求 maxTokens 计算上界；无法容纳下一次请求时，发送前停止，即使实际请求可能更便宜。并发共享同一预留池；未知 usage 保留预留并停止，不能再次自动请求。结束按实际 usage.cost.total 计入成本，达到上限立即停止。该本机预算基于 SDK 费率/token 上限，不能代替服务商账户的账单上限；若服务商返回超出目录上界的费用，报告失败并停止后续请求，无法撤销已经计收的费用。

报告 `report-record.json` / `report-replay.json` 包括阶段结果、每岗 input/output/total token、cacheRead/cacheWrite、usage.cost 费用、岗位及 provider 耗时、由 reset 事件统计的纠正重试次数、截断、失败原文、全部调用和录制索引。原文取自既有安全处理后的录制响应，不保存原始 provider 异常、thinking 或系统输入；协调员引用原话的失败仍使用来源引用。被纠正的原始尝试可在 calls 的 recordedResponse 中审阅。完整候选稿同时位于 candidate 字段和 `candidate-record.md`；失败/截断作者尝试位于 candidateDrafts，不晋升为候选稿。memoryPreview 只供审阅。

人类以后批准真实模型验证时，可按既有模型路由配置凭证、REAL_MODEL=1 与部署 RUWEN_CANARY，再运行一条命令（工具会读取当前目录 .env，但不写入配置）：

```sh
pnpm p3:smoke --live --max-usd 5 --output .local/p3-smoke/human-run
```

`--live` 只改变录制上游；账本在独立工具数据库中始终使用沙箱点数，按既有配置记账，不开启真实收费。实际 provider 费用由美元预算单独计量。live 录制也可使用普通 replay 命令，无需 key。一次 smoke 不等于 P3 门已通过，报告 p3GatePassed 始终为 false。本批仅用 faux/replay 验证，未配置 key、未执行 live。

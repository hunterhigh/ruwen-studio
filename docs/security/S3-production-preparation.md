# S3生产准备记录（2026-11-11）

本轮只准备，不部署、不创建外部账户，P3和公开上线闸门保持。严格只读运行由容器宿主配置，不能由Dockerfile宣称已在所有平台生效。

| 控制 | 实现/验证入口 | 尚待实际环境验证 |
|---|---|---|
| 两生产镜像 | 多阶段、Node digest固定、生产依赖、UID/GID1000、代码无写权限；忽略.env/.local/recordings | CI containers实际构建/启动为合并条件 |
| 只读文件系统 | Compose read_only、仅/tmp tmpfs、cap_drop ALL、no-new-privileges；CI用root尝试写根目录须EROFS | Fly/Railway实际根挂载配置尚未验证，不伪造平台键 |
| 独立迁移 | release迁移应用/pg-boss，运行进程只核验应用迁移哈希；缺失拒绝启动 | 托管PG角色及升级维护入口 |
| 探针/停机 | DB限时且合并并发探测，web/api/health、私有worker/health；未启动/关闭/数据库不可用为503，SIGTERM正常结束 | 实际平台持续监控和告警 |
| 入口代理 | 必须明确平台/CIDR/公开HTTPS URL，只读经核验peer的平台IP；覆盖伪造XFF、错peer、缺头、Cookie/CSP | Fly/Railway真实peer范围、避免私网/公网TCP旁路 |
| 日志/Sentry | 运行ID/岗位/耗时等白名单；丢弃正文/密钥/原始异常/SQL/请求，生产入口保护第三方console；Sentry无DSN关闭，关闭全部内容采集，事件重建 | 实际DSN投递与运营告警，不上传稿件/转录/源码上下文 |
| 备份/恢复 | 官方PG18客户端；新库单事务还原、拒绝覆盖；本地42表8615行业务SHA-256一致，文件内容哈希全部有效 | 离机加密存储、排程/保留期/RPO/RTO及生产恢复审批 |
| 供应链 | pnpm audit --prod高危/critical阻断fast；Vitest升4.1.12消除旧critical；精确Sentry11.11.0遵守24小时冷静期；Dependabot npm/actions/docker | 后续自动更新仍须CI和既有批准门 |
| 运维 | runbook覆盖部署/回滚/轮换/冻结/费用复核/上游锁更新；操作员冻结使用账户锁与现有只追加风险审计 | 出口白名单、生产secret scanning设置、上线前渗透/事故通报流程尚待平台与人类 |

Sentry采用官方v11数据采集选项，并关闭默认集成、正文/头/用户/AI/SQL参数采集，beforeSend仅保留白名单事件；没有DSN时不init。这里刻意不采集异常原文和堆栈，排查深度有限，不能为方便调试恢复原始稿件或密钥日志。[官方选项](https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/)

PG客户端下载自PostgreSQL官方推荐的[EDB便携归档](https://www.enterprisedb.com/download-postgresql-binaries)，仅解压到独立D盘工具目录，未安装服务。归档本地SHA-256为`e2246ba91d22345bc3d017586c09ede52d9df180b1eeb480f050445f1cad84e2`，是此次下载指纹，不冒充发布方签名。演练在54429测试库，恢复到全新ruwen_restore_drill_20261111082410825；42表8615行综合SHA-256为`0292023d7355519fef6f3cf366ef7de6c9b28388dbc2673ba349cd923a006cc5`，归档和原始证据仅在忽略目录。

没有新增提示词防护机制/测试、模型工具、正文语义过滤或SIGKILL矩阵。vendor和I1–I13保持。具体验收与未完成项见[phase-7](../reports/phase-7.md)和[runbook](../runbook.md)。

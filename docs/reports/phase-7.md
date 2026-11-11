# P7上线准备（2026-11-11；未部署）

## 做了什么
- web/worker两份多阶段生产镜像，固定Node digest、生产依赖、非root、应用无写权限；Compose严格只读根、tmpfs、降权，CI新增containers实际启动检查。
- 独立release迁移应用/pg-boss；生产启动只核验迁移。web与私有worker探针核查DB，配套SIGTERM、Fly东京样板与Railway说明，入口代理须可信CIDR和公开HTTPS URL。
- 备份/新库还原/本地演练脚本；运维手册覆盖发布、回滚、轮换、审计冻结、未知费用复核和上游submodule/提示词哈希锁更新。
- Sentry无DSN关闭；生产日志与Sentry仅运行元数据白名单，不含密钥、正文、原始异常/SQL/头/堆栈。依赖审计高危阻断fast，Dependabot覆盖npm/actions/docker；Vitest升4.1.12消除旧critical。

## 测试结果
- PG18.6真实备份/还原、覆盖拒绝、账本/批准/文件哈希对比及迁移/探针/日志/代理/操作员冻结集成通过；网页归属与CSRF既有断言保留。
- 本地隔离库54429演练：42表8615行恢复指纹一致，所有项目文件哈希有效。指纹及工具来源详见[S3记录](../security/S3-production-preparation.md)，归档不进仓库。
- 本机lint/typecheck、71文件659项全量通过（333.33秒），健康/启动/worker定向14项通过，生产构建及全部22项浏览器通过（4.3分钟）。同步B冒烟工具后的完整组合与Linux镜像结果见[PR #21](https://github.com/hunterhigh/ruwen-studio/pull/21)；最新main的fast/full/containers全绿才合并。

## 未完成与风险
- 没有部署staging或公开上线、没有外部账户/key；P7准备完成不能替代P7实际部署验收或P3。3000试用快照和54329数据库不动。
- 本机无Docker，镜像构建/只读启动由Linux CI验证；Fly/Railway实际只读挂载、入口peer、出口白名单及secret scanning平台设置仍待实际环境落实，不伪造配置项。
- 未验证真实Sentry投递、SMTP/Google/搜索/支付沙箱、离机备份排程或渗透测试；日志不采原始异常/堆栈，排查信息有限。

## 需要人类决定的事
- 选择/提供实际平台账户、应用名/域名、托管PG及操作角色，确认地区与预算；staging验证入口CIDR、只读根和出口限制后才部署，当前未执行。
- 提供可选DSN和外部服务凭据、批准备份加密存储/排程/保留期与恢复目标；完成正式条款/隐私政策及上线前安全验收。
- P3时另提供模型key与费用上限，审阅真实候选稿/成本并决定模型与定价；收费仍默认关闭。完成本轮三项后停下等试用反馈。

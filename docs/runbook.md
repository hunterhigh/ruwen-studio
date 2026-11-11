# 如文运维手册

这是上线准备，尚未部署。P3、人类试用、外部认证/搜索/支付沙箱及正式条款仍有独立验收；任何命令执行前确认目标账户、应用和数据库。当前3000人类试用目录和54329数据库不能作为本轮部署/恢复目标。

## 构建与发布

`deploy/Dockerfile.web`、`deploy/Dockerfile.worker`固定Node镜像digest，分阶段安装/构建，最终UID/GID为1000、应用文件无写权限。运行时还必须启用只读根文件系统，仅/tmp临时可写；这由宿主运行器决定，Dockerfile本身不能设置挂载选项。

演示项目由镜像构建步骤生成fixtures/demo-project.zip，RUWEN_BUNDLED_DEMO=1时web/容器验收只读该归档并导入Postgres，不在只读源码树申请LocalDirFS事务锁；不得通过开放源码目录写权限解决打包问题。

```sh
docker build -f deploy/Dockerfile.web -t ruwen-web:reviewed .
docker build -f deploy/Dockerfile.worker -t ruwen-worker:reviewed .
# 使用仓库外、权限受限的操作员环境文件；不要把密钥放进构建参数。
docker compose --env-file "$OPS_ENV_FILE" -f deploy/compose.production.yml --profile release run --rm migrate
docker compose --env-file "$OPS_ENV_FILE" -f deploy/compose.production.yml up -d worker web
```

迁移是独立release步骤，`pnpm db:migrate` / `node scripts/production-entry.ts migrate`只迁移应用及pg-boss并初始化计费策略，不启动消费者或调用模型。web/worker生产启动只核验迁移哈希，缺失或旧迁移拒绝启动。运行时pg-boss需要管理自己的队列/分区；应用公共schema迁移使用单独操作员权限，不把自动迁移混入每个进程启动。

两服务使用同一个DATABASE_URL、WORKER_QUEUE、MODEL_MODE与SEARCH_PROVIDER配置。生产密钥由平台注入：DATABASE_URL、RUWEN_CANARY、BETTER_AUTH_SECRET和公开HTTPS的BETTER_AUTH_URL必须有效；SMTP及可选Google/搜索/Sentry按实际配置。无SENTRY_DSN时监测不初始化。MODE保持faux、REAL_MODEL=0、P3_GATE_PASSED=0、REAL_CHARGING_ENABLED=0、INVITE_ONLY=1；本轮未开启真实模型或收费。用管理员邀请码发放入口创建邀请，不使用本机预览邮件模拟生产投递。

健康检查：web `/api/health`、worker私有端口8081 `/health`，成功须应用已就绪且数据库可读；启动/停机/数据库故障返回503。探针不返回DSN或错误文本。worker端口不配置公网服务。SIGTERM停止消费/关闭健康入口；用现有取消接口取消活动模型调用，未知费用保留待核对，不通过重启强行清零。

### Fly.io东京样板

`deploy/fly.web.toml`与`deploy/fly.worker.toml`默认nrt，两个应用、同一托管Postgres。web的release_command执行迁移。未来获得上线授权、账户、域名和密钥后才运行：

```sh
fly deploy --config deploy/fly.web.toml --app "$FLY_WEB_APP"
fly deploy --config deploy/fly.worker.toml --app "$FLY_WORKER_APP"
```

应用名刻意由真实目标参数提供，没有创建任何账户/应用。升级前备份，在平台维护入口停止受理、确认活动运行及未知费用，再迁移/发布两服务，探针和冒烟通过后恢复流量；不能在未准备维护入口时对有流量的服务直接执行示例。发布记录保存两镜像digest与Git SHA。

平台TLS终止后，web仅以`HTTP_FROM_PROXY=1`启用内部HTTP，必须配置`TRUST_PROXY_PROVIDER=fly`以及实际入口peer的`TRUSTED_PROXY_CIDRS`。CIDR来自平台和staging核实，不能填0.0.0.0/0或::/0。来源socket不在名单或没有合法Fly-Client-IP时拒绝；不信任用户XFF，公开host/proto由BETTER_AUTH_URL重建。不要把内部HTTP直接暴露为公网TCP服务，隔离同组织私网调用者。配置缺失会启动失败，不能用猜测的CIDR冒充验收。

**平台待核实**：Fly公开配置文档未提供已验证的只读根挂载开关；没有发明read_only TOML键。本仓库通过Compose/CI验证严格只读运行，但Fly实际挂载与worker出口白名单仍要在staging账户落实；无法实现时不能声称达到该上线安全项，应选择支持这些限制的运行器或重新经人类决定。样板未部署。

### Railway对应

两服务分别使用`deploy/railway.web.json`和`deploy/railway.worker.json`作为配置路径，Dockerfile从仓库根构建。web的preDeployCommand承担迁移，失败阻断发布；不要两服务重复自动应用迁移。Railway注入PORT，web已读取它；公开HTTPS入口用`TRUST_PROXY_PROVIDER=railway`，只信任已验证peer的X-Real-IP。配置其余同Fly并共用数据库/队列。

选择实际可用且人类批准的地区，不声称Railway已有东京可用区。web设置`/api/health`；Railway部署探针不等于持续监控，worker通过私网探针/运行监控另接。只读挂载、出口限制、生产备份和外部凭据也须在实际平台核实，本轮未创建服务。

## 回滚与事故

优先停止新受理，保留失败运行/role intent/费用记录。将web、worker一起回到上一次验证过的镜像digest，先核实它能读当前schema；只追加迁移不自动执行逆向SQL，旧代码不兼容时用向前修复或离线恢复。不得通过删除批准消费标记、role_runs或账本“重跑”。故障报告只包含运行ID、阶段、错误类别与时间，正文另按受控支持流程取得授权。

密钥泄露：先在对应服务商创建并注入新密钥，再吊销旧值；平台滚动替换两服务，核查费用与访问。模型/搜索/支付密钥各自轮换；支付webhook密钥按服务商签名切换窗口复验，不跳过验签。轮换BETTER_AUTH_SECRET使既有会话失效，通知用户重新登录；同时换入口IP证明密钥（未单设时随auth secret）。金丝雀只在部署环境换值，不更新公开提示词锁或把值写入事故报告。数据库凭据轮换后检查两服务健康并撤销旧角色访问。

账户应急冻结：操作员在正确环境使用`node scripts/freeze-account.ts TARGET_USER_UUID ACTOR_ADMIN_UUID`。actor须是ADMIN_EMAILS中已存在的管理员；账户锁内更新冻结并追加account_risk_audit，不伪造风险事件、不改余额。冻结阻止新受理和下一岗位调用，已在生成的请求需另取消并核费。后台读取该账户风险记录、确认状态后人工解冻，不能删除历史事件或直接重置风险分；跨租户事件先隔离接口、评估影响并由人类处理通知义务。

待核对预留：打开`/admin/reservations`，核对服务商实际账单与role_runs已知用量；填写理由并输入运行的实际总USD费用，或明确释放剩余预留。操作按原受理费率追加补差、更新预留和审计，不能把未知当零，也不能删除已核实消耗。用户账户页会显示待核对额与结果。退款/争议及延迟webhook由人类对账，不直接编辑credit_ledger。

## 备份与恢复

在受控操作员主机准备Node依赖与PostgreSQL18客户端（PG_BIN可指向其bin目录）；不在运行容器临时安装工具。备份含用户作品和认证数据，保存位置必须加密、权限受限，不进Git/CI artifact/普通日志。离机存储、排程、保留期和恢复时限需人类批准并实际配置，本轮只提供脚本和本地演练。

```sh
# DATABASE_URL由密钥管理注入，命令/日志不展开它。
pnpm db:backup /secure-backup/ruwen.dump
# RESTORE_DATABASE_URL指向一个全新ruwen_restore_*库，并注入RESTORE_CONFIRM=该库名。
pnpm db:restore /secure-backup/ruwen.dump
```

恢复脚本先查库名，再创建新库，以单事务还原，无DROP/--clean/覆盖路径；已有目标会拒绝，失败库留待操作员调查。只恢复可信的自有归档。先在隔离网络离线检查schema、项目文件sha256、批准消费、余额/预留与待核对记录，再决定切换；归档包含队列，未对账前绝不启动消费者指向恢复库，避免外部调用和重复副作用。恢复后的会话/支付凭据与源库同样敏感。

`node scripts/db-restore-drill.ts`仅接受显式DRILL_DATABASE_URL中的本机ruwen_test_*库，拒绝试用54329；源库停写后对所有public业务表做逐行SHA-256指纹与文件内容哈希检查，恢复到新库并对比。演练只输出计数/指纹，结果与归档放忽略的.local/backups；不会拉取或重启人类试用服务。

## 升级上游与哈希锁

日常工作永不编辑vendor内容。只有另获明确上游升级授权后，开独立分支，`git -c submodule.recurse=false submodule update --init -- vendor/ruwen`，在submodule checkout经审阅的新commit（不递归私有子模块），完整审阅旧/新SKILL、岗位、shared和参考文件diff，不摘录替换原文。设置LF，先运行`pnpm check:prompt-sources`确认旧锁会拒绝变动；随后`node scripts/check-prompt-sources.ts --update`生成新commit/文件哈希锁。

提交submodule指针、锁文件和上游提示词diff摘要，重跑快照、完整源文件子串/可见性、差分、不变量与全部CI；装配缓存/role_runs新哈希须能溯源。锁更新必须交人类审阅，不能因为CI绿自动合并；模型/提示词行为重新进入P3授权验收。不要在本轮P7准备中实际升级vendor。

依据：[Fly配置](https://docs.fly.io/reference/configuration)、[Fly入口头](https://fly.io/docs/networking/request-headers/)、[Railway预部署](https://docs.railway.com/deployments/pre-deploy-command)、[Railway探针](https://docs.railway.com/deployments/healthchecks)、[Railway入口头](https://docs.railway.com/networking/public-networking/specs-and-limits)、[Compose只读限制](https://docs.docker.com/reference/compose-file/services/)、[Sentry数据收集选项](https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/)。

# 本地数据库与worker

不需要模型API密钥。以下演示使用faux；不会自动批准候选稿或记忆。

## 无Docker本地开发

从仓库根目录在一个终端运行，服务只监听127.0.0.1:54329，数据保存在被Git忽略的.local/postgres：

```powershell
pnpm db:dev
```

另一个终端运行worker（设置仅影响该终端，不必修改API配置）：

```powershell
$env:DATABASE_URL='postgresql://ruwen:local_test_only@127.0.0.1:54329/ruwen_dev'
$env:MODEL_MODE='faux'
pnpm --filter worker dev
```

第三个终端创建新的合成演示用户/项目、导入演示资料并入队第一章：

```powershell
pnpm demo:db
```

脚本打印ownerId/projectId/runId；worker执行后停在AWAITING_CANDIDATE_APPROVAL，不更新正式章节。此初始化入口只允许本机ruwen_dev库，不用于生产。local_test_only是公开本地开发密码，不是生产密钥。停止服务用Ctrl+C，数据库目录保留；不得删除真实项目来重置测试。

P4批准生产者接口为WorkerService.enqueueApproval(PostgresFS, runId, 'candidate'|'memory', decision)，必须传confirmed:true和已审阅哈希，服务端再次读文件核对。尚未开放HTTP接口；网页登录和批准页面在P5。不能仅凭owner UUID作为公开API身份凭证。

## 测试

```powershell
pnpm test
```

默认globalSetup启动真实临时Postgres，随机端口/密码，结束时关闭并清理它创建的临时目录。需要能运行安装包附带的本机Postgres二进制；不会为此创建操作系统用户。以root运行的Linux容器应使用外部Postgres方式。

已有Docker环境可运行：

```powershell
docker compose up -d --wait postgres
$env:TEST_DATABASE_URL='postgresql://ruwen:local_test_only@127.0.0.1:54329/ruwen_test'
pnpm test
docker compose stop postgres
```

测试库名必须是ruwen_test或ruwen_test_开头，避免误用开发库。测试会创建合成用户/项目；不要指向生产数据库。Compose和本机原生服务使用同一端口，只选其一。

## 恢复与进度

worker队列默认ruwen-work。基础设施重投使用持久结果缓存；RETURNED、失败结果和结果未知的模型调用不会进入自动文学重写。FAILED且提示unknown provider outcome时，保留数据并核对服务商记录，不能删除role_runs/批准标记来强制重跑。P6需为这种未知费用保留结算边界。

LISTEN ruwen_runs接收{projectId,runId,status}，正文从授权查询读取。通知是唤醒信号；断线重连应按运行ID查pipeline_steps。迁移首次启动自动应用，已应用SQL不能原地编辑，后续改动必须新增迁移。

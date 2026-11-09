# ADR-007 · Worker并发、队列预算与数据库读取

日期：2026-11-09。状态：B2/B3已实施。

## B2决定

使用已安装pg-boss的WorkOptions.localConcurrency，默认4，可通过WorkerOptions.concurrency设置1–4。12连接的项目连接池保留给锁、项目事务和取消轮询足够余量；不同项目独立并行。同项目仍由跨进程/跨机器的session advisory lock串行，模型I/O期间不持有数据库事务。

实际worker入口支持WORKER_CONCURRENCY、ROLE_TIMEOUT_MS、QUEUE_MARGIN_SECONDS，.env.example列出默认值；配置由构造器校验，错误配置启动失败，不静默改用其他额度。

pg_advisory_lock改为pg_try_advisory_lock。忙时立即释放连接，再用pg-boss sendAfter持久重投，退避250ms、500ms、1s……上限30s；不把健康任务的锁竞争算成模型失败或消耗5次基础设施重试。当前任务只有持久重投成功才完成，入队失败则抛错让原任务重试。极端强杀导致重复投递，仍由项目锁、run状态及岗位缓存保护，不自动重复模型收费。未获得锁的处理器不会删除另一个运行的取消控制器，也不会释放别人的锁。

默认岗位超时600000ms、输出尝试2次，改为与runRole共用常量；WorkerOptions.roleTimeoutMs同步用于真实岗位执行和队列预算。CHAPTER_ROLES集中定义并用于实际章节调用链，包括作者、读者、编辑、两核验和记忆6岗。expireInSeconds=ceil(岗位超时ms×岗位数×输出尝试次数/1000)+余量秒，默认余量120秒，结果7320秒。虽然人工批准会把链拆为多个作业，按整条6岗链保守计算；外层岗位超时已包含格式纠正，此公式保留额外余量。重启对已有队列updateQueue，不能只createQueue而留下旧3600配置；已在运行的旧job元数据不追溯修改。

验证：真实Postgres/pg-boss测试在一个进程挂起项目A作者时，让项目B完成，项目A第二任务仅退避且无模型调用；检查无等待advisory锁的连接，释放A后两个A任务各完成且各仅5个费用事实。另一测试核对非整秒超时公式、默认7320和已有队列更新；原SIGKILL/heartbeat恢复、取消和幂等费用测试继续运行。

## B3只读路径决定

事务外read/readText/exists/list/sha256进入独立REPEATABLE READ READ ONLY事务，使用不加行锁的项目归属SELECT，再读取文件；归属与文件共享同一MVCC快照，不出现两次READ COMMITTED查询之间转移归属造成的不一致。长写事务进行期间返回最近已提交版本，不读取未提交内容。FOR SHARE仍会等待现有FOR UPDATE，因此不采用。

显式写事务及put/remove/createExclusive的项目FOR UPDATE、嵌套savepoint和批准原子性保持不变；写事务内读取继续复用原事务，可见自己的未提交写入。关闭的事务句柄仍拒绝读取，外部读取仍逐次校验租户归属。

新增真实Postgres并发测试：写事务更新文件后挂起，五种读取在释放写者前完成且得到原已提交字节和哈希；写者提交后新读取才看到新版本。1500ms超时用于识别阻塞，finally无论断言成败都释放写者。原FS契约、归属隔离、写事务回滚及历史测试继续运行。

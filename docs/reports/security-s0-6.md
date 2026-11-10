# S0-6：思考隔离、降低误判与增量输出

实现日期：2026-11-09；最终验证日期：2026-11-10。独立分支feat/security-s0-6，基于PR #2合并提交c782b17。PR #2经本轮人类明确授权后合并；本PR不自动合并，也不开始构思后端。

## 实际行为

- thinking块与签名不参与重合/金丝雀检查，只有provider内部后续调用仍可使用。公开transcript、项目报告、文件历史、ZIP、API、SSE及v3录制双向消息全部剥离。新增0005清理已保存的数据；本地旧报告沿用显式migrate-private-prompts CLI。归档拒绝未清理的旧报告，不把思考静默带出。
- 所有岗位检测器读取上游assets/project-template全部公开文件作为豁免，不把它们传给模型。金丝雀永不豁免。聊天/纯文本默认30、结构化岗位默认60，环境配置及文档标注“待 P3 用真实模型校准”；未改上游或三份附注原文。
- 结构化岗位首次prompt_overlap清除失败助手/工具上下文，保留原始输入，追加指定纠正语，最多重试一次；重复命中失败。金丝雀立即失败不重试，创意协调员仍使用固定拒绝语，作者重合仍失败。格式纠正预算独立，岗位总超时不增；所有实际usage保留，安全事件沿用幂等持久化。
- 增量命中先拦截发布，完整响应再按金丝雀优先确定风险类型，避免较长金丝雀先命中重合窗口而被重复计分；实际不同尝试的事件保留。
- 安全文字在岗位结束前即通过onDelta和既有worker事件机制发出。仅暂扣可能完成匹配的尾部，保护跨字段、跨轮、跨delta、NFKC、标点/空白及后续组合音标；最终检查通过后补发尾部。原始Unicode与换行不改写。归一化尾部预算≤重合长度−1加原始金丝雀长度；超预算且不可拆分的病态组合字符簇停止输出，不扩大缓冲或泄露片段。失败可留下已经检查的安全前缀，命中片段不发布。
- worker、web、自带预览启动入口及Next Node instrumentation提前验证RUWEN_CANARY。缺失/无效立即报清楚的配置错误，不打印值，早于数据库连接、TLS生成或监听请求。本项按最新指令仅在apps/web添加启动接线，没有改页面/API。

## 兼容与生效

0005由现有migrate启动路径自动执行，仅清理平台岗位缓存与报告/历史，不改变正典、注册表、审批或审计内容。旧本地目录可运行`DATABASE_URL=平台数据库 node scripts/migrate-private-prompts.ts --project <目录>`；没有配置或修改生产数据库。

录制升级为v3：请求哈希忽略thinking，后续多轮回放仍匹配；拒绝只保存类型元数据，以便重放单次纠正且不保存被拒原文。旧v1/v2失败关闭，需重新录制。所有测试只用faux/注入的测试实现，无API key、真实模型、真实搜索或支付调用。

末轮检查还收紧了尚未启用的P3基准脚本：provider请求报告先剥离system/thinking，再写到样本项目之外的私有目录，不再把原始上下文写进项目。未调用该真实模型入口。

## 验证

最终执行`pnpm lint && pnpm typecheck && pnpm test --maxWorkers=1`全绿：43个文件、440项测试，耗时444.22秒。Windows仅限制文件并发，没有放宽断言、超时、批准门或隔离规则。`pnpm check:prompt-sources`通过，23份来源仍对应vendor提交9835470fa07b216c85602915a38063b0d7c937b5，无上游改动。`pnpm build:web`优化构建与其TypeScript检查通过。

推送后的[本分支Linux CI](https://github.com/hunterhigh/ruwen-studio/actions/workflows/ci.yml?query=branch%3Afeat%2Fsecurity-s0-6)按既有流程使用Ubuntu、Node 22.19、Python 3.11与Postgres，原样运行`pnpm lint && pnpm typecheck && pnpm test`；最终提交状态见PR的Checks。未运行会复用主线程预览数据库的Playwright，本次差异使用隔离数据库的真实HTTP/ZIP/SSE测试和生产构建验证。

专项验证包括：全部模板及所有岗位豁免、30/60可配置阈值、编辑纠正后成功与费用保留、重复重合/金丝雀策略、格式纠正后仍仅一次重合纠正、跨delta金丝雀和规则片段、组合音标跨块防泄露、尾部预算、正常文字先于provider结束到达、双向思考/签名剥离和多轮录制回放、真实HTTP/文件/ZIP/SSE检查、旧SQL与历史清理，以及真实进程入口缺配置立即退出。

## 停点

更新ADR-010与docs/security/S0-3.md，单独提交、推送并开PR后停下，等待人类审阅、合并确认。构思后端尚未开始。

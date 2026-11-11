做了什么
- 第1项已由PR #28完成：请求UTF-8上界和零provider的--plan，本项不重复实现。
- 共享模型key来源限制：拒绝文件凭据与覆盖，只读进程环境；worker/CLI采用安全入口，SDK输出与录制脱敏。
- A线程接入说明见 docs/model-credential-runtime.md；apps/web由A接入，未修改。
测试结果
- 使用固定假凭据/faux验证文件拒绝、父进程优先、覆盖拒绝、跨delta和错误/报告脱敏；PR CI为全量依据。
未完成与风险
- DeepSeek路由及ping将在下一批实现；未读取真实key、未运行live，不代表P3通过。
- 人类明确不把key写文件；代码只检查运行配置，不进行硬盘扫描。
需要人类决定的事
- 无；共享限制CI全绿合并后继续DeepSeek路由。

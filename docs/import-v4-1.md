# v4.1 旧项目只读迁移预览

```sh
pnpm core migrate-v4-1-preview --project-root /path/to/legacy
pnpm core migrate-v4-1-preview --project-root /path/to/legacy --output /outside/preview.json
```

命令总是向 stdout 输出 JSON；`--output` 只在用户明确指定时生成源项目之外的新报告，拒绝覆盖已有文件。没有 `--apply` 或自动迁移操作。源目录读取不创建锁文件、事务副本或 v5 项目文件；拒绝目录内符号链接和路径逃逸。预览期间应暂停外部编辑，报告中的哈希只描述当次读取的字节，不是批准。

程序接口：`core.migrateV41Preview(projectFS)` 用于已获授权的项目 FS；`core.previewV41Directory(root)` 用于本地只读目录。调用方仍负责平台项目归属验证；本轮没有新增网页/API 路由。

分类规则、前缀顺序、建议路径、警告和排除项逐项移植固定上游 `9835470fa07b216c85602915a38063b0d7c937b5` 的 `migrate_v4_1_preview.py`。包括 `continuity/` 后缀拼接等上游现有行为；建议路径不能直接作为已批准文件计划执行。人工仍须决定混合资料的拆分、资料所有者与作用域，表现材料仍须审计/试写/激活门。

差分测试以 Python 3.11+ 运行该固定脚本，比较 TS 库和无 Python 运行时依赖的 TS CLI。`packages/core/test/fixtures/v4-1/provenance.json` 记录“东方战国”样本的来源、提交号、文件数和压缩包 SHA-256。样本来自较新上游提交 `61c58e2565e146ae8b91eb869e7791de3bdad719`；当前 vendor 固定版本不含该项目，因此只保存测试夹具，未更新或修改 vendor。测试在临时目录解包，对比完整预览并核对源文件前后哈希。

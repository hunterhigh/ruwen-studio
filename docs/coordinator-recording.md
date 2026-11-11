# 协调员录制：数据库来源引用格式 v1

普通岗位继续使用既有 version 3 夹具。协调员使用 version 4 / `source-references-v1`，文件为平台工作区 `.local/model-recordings/coordinator-<requestHash>.json`，不进入项目文件系统、导出或 API。没有数据库输入绑定的协调员 record/replay 在 provider 调用前失败，不能回退为普通岗位的完整请求录制。

每个文件只有 version、format、requestHash、sources、payload 和 payloadSha256。requestHash 沿用语义请求哈希；sources 只有来源 SHA-256 与原文码点数，没有原文、字符字典、加密原文或整个 request/context。payload 包含经过既有安全边界处理的回复、usage、模型及安全选项，以类型化 JSON 编码，不进行字符串模板替换或代码执行。

字符串的 `text` 数组由两种片段组成：

- `{source,start,end}`：从本回合数据库来源的派生字典读取，码点位置从 0 开始，end 排他。
- `{literal}`：仅包含不在来源字典中的字符。原话的局部复述、重复和对象键也使用引用。

字典索引为 `4 * 来源序号 + 变换序号`；变换固定为原文、NFKC、NFKC小写、NFKC大写。这些字典仅在内存中生成，不存入夹具。这样也能引用正常的宽窄字、组合字符或英文大小写变化；模型实际输入/输出不被归一化或改写。对象键和值均编码，数字/布尔/null保持类型。响应中的用户文字不能靠把它放进工具参数键或普通字符串绕过引用。

重放重新获得本会话数据库输入，再校验完整 requestHash、每个源哈希/长度、payload 哈希及引用边界。缺少绑定、输入变化、旧协调员 v3 记录或损坏数据均拒绝，绝无真实 provider fallback。夹具不承担保存会话原话的职责；重放须有原数据库会话，或由调用者重新提供完全相同的受授权输入。模型/提示词/输入等语义配置变化需要重新录制。

`ModelRuntime.bindCoordinatorSources(read)` 返回单次岗位调用专用的 runtime，不能在共享 recorder 上存放可变的全局原话。worker 初次从 `coordinatorInput` 绑定，之后每次 `prepareRequest` 从数据库重载时更新同一调用的来源。并发项目各自持有独立读取闭包。直接调用 runRole 的测试/工具也须显式绑定；服务端的 `coordinatorRecordingFormat` 是能力配置，不能由 HTTP body 指定。

系统提示词仍按既有私有边界处理，thinking/signature 沿用现有剥离；凭证在引用编码前按既有规则移除。本批没有增加提示词防泄露机制或测试。record 受主线程现有 live 计费/冻结门约束；引用格式可用不表示 P3、真实收费或真实模型已获批准。测试只包装 faux provider，沙箱预留与真实收费开关不变。

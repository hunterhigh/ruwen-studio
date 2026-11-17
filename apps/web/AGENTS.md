# Ruwen Studio 网页端协作规则

遵守仓库根目录 `AGENTS.md` 与 `docs/PLAN.md` 的不变量。本节依据人类于 2026-11-17 授权执行的 `docs/design/FRONTEND-REDESIGN.md` 块 0 建立；仅执行当前明确指定的块，不自动开始后续块。

## 前端改版规则

1. **范围：只改前端。** 允许改 `apps/web/src/components/**`、`apps/web/src/app/**/page.tsx` 与 `layout.tsx`、`apps/web/public/**`、新建 `apps/web/src/copy/**`、`apps/web/src/ui/**`、`apps/web/e2e/**`。禁止改 `packages/**`、`apps/worker/**`、数据库与迁移、`apps/web/src/server/**`（只读使用）、任何 API 路由的请求或响应格式。如果设计需要的数据现有 API 没有提供，界面降级（隐藏该元素或显示通用文字），并在 `docs/OPEN_QUESTIONS.md` 记一条“前端改版缺数据”，不要自己加接口。指令包明确要求的规则文件、设计依据、报告及其他配套文档按对应块交付，不据此扩大产品代码范围。
2. **视觉依据：** 原型的颜色、字号、间距、组件和用词以 `docs/design/ruwen-studio-redesign.html` 的“设计规范”页为准。原型里的数据是演示数据，实现时一律用真实 API 数据。
3. **CSP 不变：** `apps/web/src/server/security.ts` 已是 `style-src 'self' 'nonce-…'`、`img-src 'self'`、`font-src 'self'`。服务端渲染的 HTML 里不得出现 `style` 属性；需要动态定位的（如页边批注的 `top`）在客户端 `useLayoutEffect` 里通过 ref 设置 `element.style`。不使用 `data:` 图片和 `data:` 字体，不引用任何外部资源。字体文件放 `public/fonts` 自托管。
4. **安全渲染不变：** 所有模型输出和用户内容继续经过 `SafeMarkdown`；禁止 `dangerouslySetInnerHTML`；不渲染外部图片。
5. **批准语义不变：** 所有批准请求照旧携带 `expectedSha256` / `expectedTargetSha256` 等字段；界面上的“阅读门槛”只是增加的前端约束，服务端仍是权威。不得自动批准、自动重试或自动重跑。
6. **文案：** 所有界面文字放 `apps/web/src/copy/zh-CN.ts`，组件里不写死中文（测试文件除外）。状态、反应类型、编辑决定等内部值一律经过用词表转换后显示。
7. **用户页面不显示：** 美元金额、模型名、token 数、缓存命中、内部枚举值、原始 JSON、文件哈希（哈希可放在折叠的“技术信息”里）。管理后台不受此限制。
8. **统一确认：** 不使用 `window.confirm` / `window.alert` / `window.prompt`，统一用块 1 的 `ConfirmDialog`。
9. **桌面范围：** 只做桌面网页，最小宽度 1180px，不做平板和手机适配。
10. **依赖：** 不新增 npm 运行时依赖。如确有必要（例如字体分包工具只在构建前离线运行一次），写 ADR 说明，且产物提交进仓库，运行时不依赖它。
11. **验证与报告：** 每个块完成时 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm test:e2e` 全绿；选择器随改版更新，保留 `data-testid="run-status"` 与 `data-testid="ideation-stream"`。用 Playwright 在 1440×900 下给本块涉及的每个页面和关键状态截图，存到 `docs/reports/frontend-redesign/<块号>/`，并写 `docs/reports/frontend-redesign/<块号>.md`：做了什么、与原型的差异及理由、新增的 OPEN_QUESTIONS。无法执行的检查据实记录具体原因，不宣称已通过。
12. **交付边界：** 一个块一个分支一个 PR，PR 描述贴截图列表。不要把多个块合并做。提交和合并继续遵守根目录 `AGENTS.md`；不直接推送 main，不 force push，最新 main 上 fast/full CI 全绿后按既有授权合并。

块 0 仅交付规则与 `docs/reports/frontend-redesign/00-inventory.md`，不写功能代码。旧界面的文案、确认框与视觉替换按后续各块实施，不在块 0 提前整改。

执行任何块之前，先读 FRONTEND-REDESIGN.md 末尾的勘误；勘误与块正文冲突时，以勘误为准。

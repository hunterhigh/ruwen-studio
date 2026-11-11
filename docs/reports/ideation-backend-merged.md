做了什么
- PR #6→#7→#8→#9逐一改基准/同步main，fast/full全绿后按序合并；未force push或直接推main。
- 最终验证提交：afd2d37d6b7f5dcf3afa1c3d9601e8cbe9466f45（2026-11-11）。
测试结果
- 该main：pnpm lint、pnpm typecheck、pnpm test通过（58文件/548项）。
- pnpm build:web及全部17项Playwright通过；本机独立3300端口/独立worker队列，未复用旧预览。
未完成与风险
- 仍为faux；P3真实模型、真实搜索/支付和P5人类试用不因此视为完成。
需要人类决定的事
- 无；v1.2契约另开PR等待确认。

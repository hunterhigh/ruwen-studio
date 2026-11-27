# CSS 清理清单

studio.css 从 5,249 行减至 4,438 行。脚本解析选择器并枚举 469 个类名，在 `apps/web/src` 搜索完整类名，另核对动态类和组合选择器。保留封面编号、岗位、构思消息、按钮、确认框、状态、资源、骨架及开发样例等动态类。无声明与选择器都完全重复的规则。

- 迁移全部引用后移除 `--mist`、`--navy`、`--steel`、`--annotation`、`--teal`、`--line`、`--muted`、`--ui`、`--story`。
- 原有未使用的 55 个类涉及 162 个选择器项。管理后台接入统一提示条后，另删 `.admin-error`。

- `.account-note`、`.account-warning`、`.admin-error`、`.annotation-list`、`.annotation-type`、`.approval-bar`、`.billing-balances`
- `.billing-checkout`、`.billing-plans`、`.book-spine`、`.chapter-annotation-error`、`.chapter-toolbar`、`.compact-heading`、`.confirm-check`
- `.connection-dot`、`.creation-form`、`.empty-mark`、`.empty-state`、`.export-link`、`.file-diff`、`.file-metadata`
- `.history-selector`、`.login-divider`、`.login-heading`、`.login-panel`、`.margin-caption`、`.margin-tabs`、`.mode-label`
- `.muted`、`.overview-error`、`.overview-grid`、`.preview-label`、`.project-list`、`.project-nav`、`.project-row`
- `.project-row-end`、`.quote-anchor`、`.readiness-list`、`.reading-desk`、`.reading-margin`、`.return-form`、`.role-progress`
- `.run-footer`、`.run-list`、`.secondary-actions`、`.section-title`、`.shelf-footer`、`.signin-error`、`.status-pill`
- `.success-text`、`.text-button`、`.text-link`、`.upload-label`、`.usage-table`、`.welcome`、`.welcome-note`

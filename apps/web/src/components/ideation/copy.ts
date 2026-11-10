import type {
  IdeationErrorCode,
  IdeationPreview,
  IdeationRole,
  IdeationTaskStatus,
} from "@ruwen/pipeline";

/** Pending v1.1 codes are presentation-only until the service contract declares them. */
export type IdeationUiErrorCode =
  | IdeationErrorCode
  | "INSUFFICIENT_CREDITS"
  | "ACCOUNT_FROZEN"
  | "BILLING_DISABLED";
export const errorCopy: Record<IdeationUiErrorCode, string> = {
  UNAUTHENTICATED: "登录已失效，请重新登录。",
  NOT_FOUND: "这项内容不存在或已不可访问，请返回项目。",
  CSRF_INVALID: "请求校验已失效，请刷新页面后重试。",
  INVALID_ARGUMENT: "请检查填写的内容。",
  INPUT_LIMIT_EXCEEDED: "内容超过长度上限，请缩短后发送。",
  TURN_IN_PROGRESS: "协调员正在回应，请等本轮完成。",
  SESSION_CLOSED: "此会话已关闭，可以阅读记录或新建会话。",
  CREATION_CHECK_FAILED: "委托尚未通过通讯门检查，请与协调员继续澄清。",
  READERS_DENIED: "该岗位无权读取所选资料，请调整资料选择。",
  RESOURCE_STALE: "来源资料已变化，请重新生成预览。",
  PREVIEW_STALE: "预览已过期，请阅读重新生成的版本后再决定。",
  ALREADY_DECIDED: "这份预览已有决定，请刷新查看结果。",
  APPROVAL_REQUIRED: "需要你明确阅读并确认批准。",
  APPROVAL_CONSUMED: "这次批准已使用，不会再次执行。",
  IDEMPOTENCY_CONFLICT: "此请求与先前操作冲突，请刷新核对结果。",
  SEARCH_UNAVAILABLE: "外部搜索尚未配置。计划仍待批准，不会改用其他来源。",
  CLOSURE_AUDIT_REQUIRED: "表现资源尚未通过闭合审计，不能确认为候选。",
  NONCANONICAL_TRIAL_REQUIRED: "请先完成隔离试写并阅读样本，再决定是否激活。",
  PRECONDITION_FAILED: "项目资料尚未就绪，请先检查来源和待提交的记忆。",
  OUTPUT_BLOCKED: "本轮输出未通过安全检查，未生成可批准预览。",
  CANCELLED: "此任务已取消，已批准资料和已发生用量保留。",
  INTERRUPTED: "运行已中断，费用待核对，不会自动再次调用模型。",
  RATE_LIMITED: "操作过于频繁，请稍后手动重试。",
  PROVIDER_UNAVAILABLE: "模型服务暂不可用，请稍后手动重试。",
  INTERNAL_ERROR: "本次操作未完成，请刷新核对状态。",
  INSUFFICIENT_CREDITS: "余额不足，请到账户页查看可用点数。",
  ACCOUNT_FROZEN: "账户运行已冻结，等待人工复核。你仍可阅读已有内容。",
  BILLING_DISABLED: "真实收费尚未开放。当前不会发起付款。",
};
export const roleNames: Record<IdeationRole, string> = {
  "chuangyi-xietiaoyuan": "创意协调员",
  "xiangmu-zhiliyuan": "项目治理员",
  "waibu-zhishi-guwen": "外部知识顾问",
  "biaoxian-shejishi": "表现设计师",
  "gushi-gousishi": "故事构思师",
  "zhangjie-qingjing-bianyiyuan": "章节情境编译员",
};
export const kindNames: Record<IdeationPreview["kind"], string> = {
  handoff: "创意通讯门",
  file_patch: "文件补丁",
  learning_plan: "学习计划",
  expression_candidate: "表现候选",
  generation_field: "章节情境",
};
export const previewStatus = {
  pending: "等待决定",
  approved: "已模拟批准",
  rejected: "已拒绝",
  stale: "已过期",
  superseded: "已有新版",
};
export const taskStatus: Record<IdeationTaskStatus, string> = {
  QUEUED: "排队中",
  RUNNING: "运行中",
  AWAITING_PREVIEW_APPROVAL: "等待预览批准",
  AWAITING_LEARNING_PLAN_APPROVAL: "等待计划批准",
  SUCCEEDED: "已完成",
  FAILED: "未完成",
  CANCELLED: "已取消",
  INTERRUPTED: "已中断，待核对",
};

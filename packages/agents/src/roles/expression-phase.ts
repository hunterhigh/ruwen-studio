import { lit, obj, str } from "@earendil-works/pi-schema";
import { formatUserMessage } from "../messages.ts";
import type { RoleId, RoleSpec } from "../types.ts";
import { ROLES } from "./index.ts";

export { EXPRESSION_CHECKS } from "./expression-review.ts";

/** Server selects this isolated phase; callers cannot replace prompts/tools with arbitrary specs. */
export function ideationRoleSpec(
  id: RoleId,
  phase?: "expression_trial",
): RoleSpec {
  if (!phase) return ROLES[id];
  if (id !== "biaoxian-shejishi")
    throw new Error("Invalid expression trial role");
  return {
    ...ROLES[id],
    buildUserMessage(input) {
      if (
        Object.hasOwn(input, "raw_user_text") ||
        Object.hasOwn(input, "conversation") ||
        Object.hasOwn(input, "brief")
      )
        throw new Error("Isolated trial only accepts its verified candidate");
      return formatUserMessage({
        noncanonical_trial: true,
        scope: input.scope ?? null,
        trial_candidate: input.trial_candidate ?? null,
      });
    },
    platformFormat:
      "平台试写格式：本次是隔离、非正典试写，只以 trial_candidate 和必要批准事实尝试文字，不提交章节，不改变正典，不把 candidate 用于正式作者资料包。通过 submit_expression_trial 提交 sample，canonical 必须为 false。",
    output: {
      kind: "tool",
      toolName: "submit_expression_trial",
      schema: obj({
        sample: str({ minLength: 80, maxLength: 4000 }),
        canonical: lit(false),
      }),
    },
  };
}

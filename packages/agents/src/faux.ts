import {
  createModels,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { markdownSection } from "@ruwen/core";
import { decodeUserMessage, unescapeTaggedMaterial } from "./messages.ts";
import { ROLES } from "./roles/index.ts";
import {
  type Data,
  type ModelRuntime,
  ROLE_IDS,
  type RoleId,
} from "./types.ts";

export const FAUX_PROSE =
  "驿吏翻过木牌，车夫已经收起麻绳。院门外的车辙压进薄冰，粮车先出了驿门。主角扶着旧伤的腿挪到廊下，信封抵在胸口。棚中的马打了个响鼻，他抬头去找负责换马的人。";
const FIELD =
  "冬日下午，主角在河谷驿站等一匹尚未卸鞍的马，旧伤使他不愿久站。院中粮车正被驿吏改挂另一座城的木牌，车夫催促装最后一袋。主角要把封信送过封冻前的山口，却不知道改道是否意味着前路已经封锁。他必须在驿吏放出下一匹马前决定是否继续；粮车会先离开。";
const scope = (input: Data): Data =>
  input.scope && typeof input.scope === "object" && !Array.isArray(input.scope)
    ? input.scope
    : {
        project: "test-project",
        volume: "v1",
        arc: "arc-1",
        chapter: String(input.chapter ?? "001"),
        scene_type: "travel",
        pov: "主角",
      };
export function fauxOutput(id: RoleId, input: Data = {}): Data | string {
  switch (id) {
    case "xiaoshuo-zuozhe":
      return FAUX_PROSE;
    case "qinggan-duzhe": {
      const prose = Array.from(String(input.prose ?? FAUX_PROSE));
      return {
        reactions: [0, 8, 16].map((offset) => ({
          anchor: prose
            .slice(
              offset < prose.length ? offset : 0,
              offset < prose.length ? offset + 8 : 8,
            )
            .join(""),
          type: "noticed",
          note: "先注意到正在离开的粮车。",
        })),
      };
    }
    case "wenxue-bianji":
      return { decision: "LOCAL_EDIT", edits: [], problems: [] };
    case "qingjie-heyanyuan":
    case "xianshi-heyanyuan":
      return { pass: true, issues: [] };
    case "jiyi-weihuyuan": {
      const resources = Array.isArray(input.resources) ? input.resources : [];
      const current = resources.find(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          value.path === "世界/当前态势.md",
      );
      const patches =
        current && typeof current === "object" && !Array.isArray(current)
          ? [
              {
                path: String(current.path),
                base_sha256: String(current.sha256),
                sections: [
                  {
                    heading: "## 活跃力量与各自运动",
                    replacement: `${markdownSection(String(current.content), "## 活跃力量与各自运动").body}粮车已经离开驿站。\n\n`,
                  },
                ],
              },
            ]
          : [];
      return {
        new_facts: ["粮车已经离开驿站。"],
        state_changes: [],
        invalidated: [],
        scope_changes: [],
        next_chapter_state: "换马与送信的压力尚未解决。",
        patches,
      };
    }
    case "chuangyi-xietiaoyuan":
      return {
        kind: "creative_brief",
        sender: "chuangyi-xietiaoyuan",
        recipient: "gushi-gousishi",
        resource_ids: [],
        scope: {
          project: String(
            (input.project_state as Data | undefined)?.project ??
              "test-project",
          ),
        },
        approval_ref: null,
        payload: {
          fixed: [],
          creative_value: "保留人物之间尚未解决的关系压力",
          unresolved_forces: ["愿意接近也担心代价"],
          open_realization: ["动作与理解保持开放"],
          destination: "故事/当前故事弧.md",
          excluded_source: ["raw_user_wording", "example"],
        },
      };
    case "xiangmu-zhiliyuan":
      return {
        changes: [],
        conflicts: [],
        scope_changes: [],
        writes_requested: [],
        patches: [],
      };
    case "waibu-zhishi-guwen":
      return {
        mode: input.approved_learning_plan
          ? "research_report"
          : "learning_plan",
        plan: ["先核对问题边界与可用资料"],
        evidence: [],
        opportunities: [],
        conflicts: [],
        destination: "研究/",
        scope: scope(input),
      };
    case "biaoxian-shejishi":
      return {
        resource_id: "expression-preview",
        resource_path: "表现/能力/当前.md",
        version: "0.1.0",
        status: "proposed",
        content: "人物能确认的信息影响叙述距离，身体负荷改变行动成本。",
        scope: scope(input),
      };
    case "gushi-gousishi":
      return {
        summary: "主角在驿站等待换马时发现粮车改道。",
        locked_events: [],
        open_questions: ["是否继续送信仍保持开放"],
        patches: [],
      };
    case "zhangjie-qingjing-bianyiyuan":
      return {
        generation_field: FIELD,
        chapter: String(input.chapter ?? "001"),
        scope: scope(input),
        locked_events: Array.isArray(input.locked_events)
          ? input.locked_events
          : [],
        locked_order: Array.isArray(input.locked_order)
          ? input.locked_order
          : [],
      };
  }
}
export function requestRole(context: TranscriptContext): RoleId {
  const source = JSON.stringify(
    context.messages.filter((m) => m.role === "system"),
  );
  const id = ROLE_IDS.find((role) => source.includes(`CURRENT_ROLE:${role}`));
  if (!id) throw new Error("Unknown faux role");
  return id;
}
function inputFrom(context: TranscriptContext): Data {
  for (const message of [...context.messages].reverse())
    if (message.role === "user") {
      const raw =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((b) => b.type === "text")
              .map((b) => (b.type === "text" ? b.text : ""))
              .join("");
      try {
        const segmented = decodeUserMessage(raw);
        if (segmented) return segmented;
        const value: unknown = JSON.parse(raw);
        if (
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value)
        )
          return value as Data;
      } catch {
        /* correction prompts are not task inputs */
      }
    }
  return {};
}
export const defaultFauxResponse = (context: TranscriptContext) => {
  const id = requestRole(context);
  const input = inputFrom(context);
  if (id === "jiyi-weihuyuan") {
    const targets = Array.isArray(input.resources) ? input.resources : [];
    const target = targets.find(
      (value) =>
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        value.path === "世界/当前态势.md",
    );
    if (target && typeof target === "object" && !Array.isArray(target)) {
      let resource: Data | undefined;
      for (const message of context.messages)
        if (
          message.role === "toolResult" &&
          message.toolName === "read_resource"
        )
          for (const block of message.content)
            if (block.type === "text") {
              try {
                const value: unknown = JSON.parse(
                  unescapeTaggedMaterial(block.text),
                );
                if (
                  value &&
                  typeof value === "object" &&
                  !Array.isArray(value) &&
                  "path" in value &&
                  value.path === target.path
                )
                  resource = value as Data;
              } catch {
                /* faux sees only returned tool results */
              }
            }
      if (!resource)
        return fauxAssistantMessage(
          fauxToolCall("read_resource", { id: target.id ?? "" }),
          { stopReason: "toolUse" },
        );
      input.resources = [resource];
    }
  }
  const output = fauxOutput(id, input);
  if (id === "biaoxian-shejishi" && input.noncanonical_trial === true)
    return fauxAssistantMessage(
      fauxToolCall("submit_expression_trial", {
        sample: `${FAUX_PROSE}风从廊下拐进院里。`,
        canonical: false,
      }),
      { stopReason: "toolUse" },
    );
  const spec = ROLES[id];
  return spec.output.kind === "text"
    ? fauxAssistantMessage(String(output))
    : fauxAssistantMessage(fauxToolCall(spec.output.toolName, output as Data), {
        stopReason: "toolUse",
      });
};
export function createFauxRuntime(responses?: FauxResponseStep[]) {
  const faux = fauxProvider({
    models: [{ id: "ruwen-faux", maxTokens: 128000 }],
  });
  const models = createModels();
  models.setProvider(faux.provider);
  faux.setResponses(
    responses ?? Array.from({ length: 200 }, () => defaultFauxResponse),
  );
  const runtime: ModelRuntime & { faux: typeof faux } = {
    mode: "faux",
    models,
    faux,
    resolve: () => ({ model: faux.getModel(), thinkingLevel: "off" }),
  };
  return runtime;
}

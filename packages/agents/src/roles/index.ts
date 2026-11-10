import {
  arr,
  bool,
  lit,
  nullable,
  obj,
  oneOf,
  opt,
  type Schema,
  str,
  union,
} from "@earendil-works/pi-schema";
import { formatUserMessage } from "../messages.ts";
import { rolePromptFiles } from "../prompts/manifest.ts";
import {
  type Data,
  ROLE_IDS,
  type RoleId,
  type RoleSpec,
  type Tier,
} from "../types.ts";
import { ideationNewFiles, ideationSectionPatches } from "./ideation-output.ts";

const bounded = (max = 1600) => str({ maxLength: max });
const list = (max = 1600) => arr(bounded(max), { maxItems: 64 });
const scope = obj({
  project: str(),
  volume: nullable(str()),
  arc: nullable(str()),
  chapter: nullable(str()),
  scene_type: nullable(str()),
  pov: nullable(str()),
});
const creativePayload = obj({
  fixed: list(600),
  creative_value: bounded(1200),
  unresolved_forces: list(600),
  open_realization: list(600),
  destination: bounded(300),
  excluded_source: arr(
    oneOf([
      "raw_user_wording",
      "example",
      "complaint_language",
      "correction_history",
      "implementation_route",
      "approval_dialogue",
      "unused_option",
    ]),
    { maxItems: 7 },
  ),
});
const consultantPayload = obj({
  known: bounded(1200),
  unknown: bounded(1200),
  learning_goal: bounded(1200),
  boundary: bounded(1200),
  allowed_sources: arr(bounded(200), { maxItems: 16 }),
  destination: bounded(1200),
});
const handoffCommon = {
  sender: lit("chuangyi-xietiaoyuan"),
  resource_ids: arr(str({ pattern: "^[a-z0-9-]{2,64}$" })),
  scope: obj({ project: str() }),
  approval_ref: lit(null),
};
const handoffSchema = union([
  obj({
    ...handoffCommon,
    kind: lit("creative_brief"),
    recipient: oneOf([
      "gushi-gousishi",
      "xiangmu-zhiliyuan",
      "wenxue-bianji",
      "biaoxian-shejishi",
      "waibu-zhishi-guwen",
    ]),
    payload: creativePayload,
  }),
  obj({
    ...handoffCommon,
    kind: lit("consultant_brief"),
    recipient: lit("waibu-zhishi-guwen"),
    payload: consultantPayload,
  }),
]);
const outputs: Record<
  Exclude<RoleId, "xiaoshuo-zuozhe">,
  { name: string; schema: Schema<Data> }
> = {
  "chuangyi-xietiaoyuan": { name: "propose_handoff", schema: handoffSchema },
  "xiangmu-zhiliyuan": {
    name: "submit_governance_preview",
    schema: obj({
      changes: list(),
      conflicts: list(),
      scope_changes: list(),
      writes_requested: list(),
      patches: ideationSectionPatches,
      new_files: ideationNewFiles,
    }),
  },
  "waibu-zhishi-guwen": {
    name: "submit_research",
    schema: obj({
      mode: oneOf(["learning_plan", "research_report"]),
      plan: list(),
      evidence: arr(
        obj({
          claim: bounded(),
          source: bounded(1000),
          uncertainty: bounded(),
        }),
        { maxItems: 32 },
      ),
      opportunities: list(),
      conflicts: list(),
      destination: bounded(300),
      scope: scope,
    }),
  },
  "biaoxian-shejishi": {
    name: "submit_expression_preview",
    schema: obj({
      resource_id: str(),
      resource_path: str(),
      version: str(),
      status: lit("proposed"),
      content: bounded(1200),
      scope,
    }),
  },
  "gushi-gousishi": {
    name: "submit_story_preview",
    schema: obj({
      summary: bounded(6000),
      locked_events: list(600),
      open_questions: list(),
      patches: ideationSectionPatches,
      new_files: ideationNewFiles,
    }),
  },
  "zhangjie-qingjing-bianyiyuan": {
    name: "submit_situation",
    schema: obj({
      generation_field: str({ minLength: 80, maxLength: 2200 }),
      chapter: str(),
      scope,
      locked_events: list(600),
      locked_order: list(600),
    }),
  },
  "qinggan-duzhe": {
    name: "submit_reading",
    schema: obj({
      reactions: arr(
        obj({
          anchor: str({ minLength: 1, maxLength: 300 }),
          type: oneOf([
            "noticed",
            "expected",
            "misread",
            "lost_interest",
            "felt_explained",
          ]),
          note: bounded(1200),
        }),
        { maxItems: 64 },
      ),
    }),
  },
  "wenxue-bianji": {
    name: "submit_edit",
    schema: obj({
      decision: oneOf(["LOCAL_EDIT", "RESTAGE", "RETURN_CONSTRUCTION"]),
      edits: arr(
        obj({
          anchor_before: bounded(200),
          anchor_after: bounded(200),
          replacement: bounded(1600),
          kind: oneOf(["fact", "literary"]),
          reason: bounded(1200),
        }),
        { maxItems: 64 },
      ),
      problems: arr(
        obj({
          location: str({ minLength: 1, maxLength: 1000 }),
          category: str({ minLength: 1, maxLength: 1000 }),
          condition: str({ minLength: 1, maxLength: 1000 }),
          handling: str({ minLength: 1, maxLength: 1000 }),
          result: str({ minLength: 1, maxLength: 1000 }),
        }),
        { maxItems: 64 },
      ),
      return_reason: opt(bounded(1600)),
    }),
  },
  "qingjie-heyanyuan": {
    name: "submit_verdict",
    schema: obj({
      pass: bool(),
      issues: arr(
        obj({
          promise: bounded(),
          problem: oneOf(["missing", "changed", "order"]),
          evidence: bounded(),
        }),
        { maxItems: 64 },
      ),
    }),
  },
  "xianshi-heyanyuan": {
    name: "submit_verdict",
    schema: obj({
      pass: bool(),
      issues: arr(
        obj({
          category: oneOf([
            "identity",
            "time_space",
            "knowledge_source",
            "physics",
            "institution",
            "ability",
            "canon",
          ]),
          evidence: bounded(),
          rule_ref: bounded(300),
        }),
        { maxItems: 64 },
      ),
    }),
  },
  "jiyi-weihuyuan": {
    name: "submit_memory_preview",
    schema: obj({
      new_facts: list(),
      state_changes: list(),
      invalidated: list(),
      scope_changes: list(),
      next_chapter_state: bounded(2200),
      patches: arr(
        obj({
          path: str({ minLength: 1, maxLength: 300 }),
          base_sha256: str({ pattern: "^[a-f0-9]{64}$" }),
          sections: arr(
            obj({
              heading: str({ minLength: 1, maxLength: 200 }),
              replacement: bounded(4000),
            }),
            { minItems: 1, maxItems: 8 },
          ),
        }),
        { maxItems: 32 },
      ),
    }),
  },
};
const fields: Record<RoleId, readonly string[]> = {
  "chuangyi-xietiaoyuan": ["raw_user_text", "project_state", "conversation"],
  "xiangmu-zhiliyuan": ["brief", "resource_ids", "scope"],
  "waibu-zhishi-guwen": [
    "brief",
    "resource_ids",
    "scope",
    "approved_learning_plan",
  ],
  "biaoxian-shejishi": ["brief", "approved_resources", "scope"],
  "gushi-gousishi": ["brief", "resource_ids", "scope"],
  "zhangjie-qingjing-bianyiyuan": [
    "approved_story",
    "resources",
    "chapter",
    "scope",
    "locked_events",
    "locked_order",
  ],
  "xiaoshuo-zuozhe": ["packet"],
  "qinggan-duzhe": ["prose", "chapter", "previous_tail"],
  "wenxue-bianji": ["prose", "reading"],
  "qingjie-heyanyuan": ["prose", "locked_events", "locked_order"],
  "xianshi-heyanyuan": ["prose", "hard_rules"],
  "jiyi-weihuyuan": ["approved_prose", "resources"],
};
const strong: RoleId[] = [
  "xiaoshuo-zuozhe",
  "wenxue-bianji",
  "gushi-gousishi",
  "zhangjie-qingjing-bianyiyuan",
  "biaoxian-shejishi",
];
const cheap: RoleId[] = [
  "qinggan-duzhe",
  "qingjie-heyanyuan",
  "xianshi-heyanyuan",
];
export const ROLES = Object.fromEntries(
  ROLE_IDS.map((id) => {
    const output =
      id === "xiaoshuo-zuozhe"
        ? { kind: "text" as const }
        : {
            kind: "tool" as const,
            toolName: outputs[id].name,
            schema: outputs[id].schema,
          };
    const spec: RoleSpec = {
      id,
      promptFiles: rolePromptFiles(id),
      output,
      modelTier: (strong.includes(id)
        ? "strong"
        : cheap.includes(id)
          ? "cheap"
          : "standard") as Tier,
      maxTurns: 8,
      buildUserMessage(input) {
        const selected: Data = {};
        for (const key of fields[id])
          if (Object.hasOwn(input, key)) selected[key] = input[key] ?? null;
        if (
          id === "qinggan-duzhe" &&
          typeof selected.previous_tail === "string"
        )
          selected.previous_tail = Array.from(selected.previous_tail)
            .slice(-600)
            .join("");
        if (
          id !== "chuangyi-xietiaoyuan" &&
          (Object.hasOwn(input, "raw_user_text") ||
            Object.hasOwn(input, "conversation"))
        )
          throw new Error(
            "Raw user input cannot be combined with a downstream role input",
          );
        if (id === "chuangyi-xietiaoyuan" && Object.hasOwn(input, "brief"))
          throw new Error(
            "Coordinator input cannot replay a translated handoff",
          );
        return id === "xiaoshuo-zuozhe"
          ? String(selected.packet ?? "")
          : formatUserMessage(selected);
      },
    };
    return [id, Object.freeze(spec)];
  }),
) as Record<RoleId, RoleSpec>;

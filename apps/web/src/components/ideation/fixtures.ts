import type {
  IdeationContextScope,
  IdeationFilePatch,
  IdeationPreview,
  IdeationProjectId,
  IdeationResourceMetadata,
  IdeationResourceRef,
  IdeationRunId,
  IdeationSessionId,
} from "@ruwen/pipeline";

/** Brands below apply ONLY to built-in local fixtures, never to server/user strings. */
export const fixtureBrand = <T extends string>(text: string) => text as T;
const b = fixtureBrand;
export const demoScope: IdeationContextScope = {
  project: b("demo-ruwen"),
  volume: "1",
  arc: "北岸",
  chapter: "2",
  scene_type: "抉择",
  pov: "林砚",
};
export const fixtureResource: IdeationResourceMetadata = {
  id: b("story-current"),
  type: "story",
  path: b("故事/当前态势.md"),
  sha256: b("a".repeat(64)),
  status: "active",
  scope: {
    project: demoScope.project,
    volumes: null,
    arcs: null,
    chapters: ["2"],
    scene_types: null,
    povs: ["林砚"],
  },
  owner: "gushi-gousishi",
  version: "1",
  readers: ["gushi-gousishi", "zhangjie-qingjing-bianyiyuan"],
  allowAuthor: false,
  supersedes: null,
};
const worldResource: IdeationResourceMetadata = {
  ...fixtureResource,
  id: b("world-ferry"),
  type: "world",
  path: b("世界/渡口制度.md"),
  owner: "xiangmu-zhiliyuan",
  readers: [
    "chuangyi-xietiaoyuan",
    "waibu-zhishi-guwen",
    "gushi-gousishi",
    "zhangjie-qingjing-bianyiyuan",
  ],
};
const patch: IdeationFilePatch = {
  kind: "sections",
  resource: fixtureResource,
  sections: [
    {
      heading: b("## 当前态势"),
      replacement: b("北岸封冻，驿卒带来南岸的求援。林砚尚未决定是否渡河。"),
    },
  ],
  beforeText: b("# 当前态势\n\n## 当前态势\n北岸封冻，驿卒未归。\n"),
  afterText: b(
    "# 当前态势\n\n## 当前态势\n北岸封冻，驿卒带来南岸的求援。林砚尚未决定是否渡河。\n",
  ),
  afterSha256: b("b".repeat(64)),
};
const expression: IdeationResourceRef & {
  type: "expression";
  status: "candidate";
} = {
  ...fixtureResource,
  id: b("expression-choice-v2"),
  type: "expression",
  status: "candidate",
  path: b("表现/抉择的动作.md"),
};
export function previewFixture(
  kind: IdeationPreview["kind"],
  projectId: string,
  sessionId: IdeationSessionId,
  taskId: IdeationRunId,
  revision = 1,
): IdeationPreview {
  const base = {
    id: b<IdeationPreview["id"]>(crypto.randomUUID()),
    projectId: b<IdeationProjectId>(projectId),
    sessionId,
    taskId,
    sessionRevision: 0,
    supersedesPreviewId: null,
    revision,
    sha256: b<IdeationPreview["sha256"]>(
      (revision % 16).toString(16).repeat(64),
    ),
    status: "pending" as const,
    summary: b<IdeationPreview["summary"]>(
      `${kind === "handoff" ? "把选择留给渡河的人" : kind === "file_patch" ? "补记北岸当前态势" : kind === "learning_plan" ? "封冻河道的渡运条件" : kind === "expression_candidate" ? "用动作承载犹豫" : "第2章：河岸来信"}${revision > 1 ? ` · 修订 ${revision}` : ""}`,
    ),
    scope: demoScope,
    resources: [fixtureResource],
    registrySha256: b<IdeationPreview["registrySha256"]>("c".repeat(64)),
    createdAt: new Date().toISOString(),
  };
  const commonHandoff = {
    sender: "chuangyi-xietiaoyuan" as const,
    resource_ids: [fixtureResource.id],
    scope: demoScope,
    approval_ref: null,
  };
  switch (kind) {
    case "handoff":
      return {
        ...base,
        kind,
        role: "chuangyi-xietiaoyuan",
        payloadSha256: b("d".repeat(64)),
        understanding: {
          creativeValue: b("义务与自保互相牵扯，让人物自己承担选择。"),
          fixedFacts: [b("河面封冻"), b("南岸有人等待援助")],
          openChoices: [b("林砚是否渡河"), b("他如何回应求援")],
          exampleTreatment: b("示例只用于理解感受，不复制措辞或具体桥段。"),
          destination: b("故事/当前态势.md"),
        },
        handoff: {
          ...commonHandoff,
          kind: "creative_brief",
          recipient: "gushi-gousishi",
          payload: {
            fixed: [b("河面封冻")],
            creative_value: b("让风险和牵挂同时成立"),
            unresolved_forces: [b("自保与援助的冲突")],
            open_realization: [b("具体行动由构思师探索")],
            destination: b("故事/当前态势.md"),
            excluded_source: [
              "raw_user_wording",
              "example",
              "correction_history",
              "unused_option",
            ],
          },
        },
      };
    case "file_patch":
      return {
        ...base,
        kind,
        role: "gushi-gousishi",
        explanation: b("只更新当前态势，不提前替人物决定渡河。"),
        patches: [
          patch,
          {
            kind: "create",
            resourceId: b("world-ferry-note"),
            path: b("世界/渡口备忘.md"),
            baseSha256: null,
            content: b(
              "# 渡口备忘\n\n封冻期暂停常规渡运。此为待批准的演示资料。\n",
            ),
            afterSha256: b("e".repeat(64)),
          },
        ],
        registryChanges: [
          {
            resourceId: fixtureResource.id,
            before: fixtureResource,
            after: {
              ...fixtureResource,
              sha256: patch.afterSha256,
              version: "2",
            },
          },
          {
            resourceId: b("world-ferry-note"),
            before: null,
            after: {
              ...worldResource,
              id: b("world-ferry-note"),
              path: b("世界/渡口备忘.md"),
              version: "1",
              sha256: b("e".repeat(64)),
            },
          },
        ],
      };
    case "learning_plan":
      return {
        ...base,
        kind,
        role: "waibu-zhishi-guwen",
        resources: [worldResource],
        known: b("北岸进入封冻期。"),
        unknown: b("渡船、绳索与冰况会怎样影响通行？"),
        plan: [
          b("核对现有世界资料中的渡运制度。"),
          b("区分已有证据与尚待调查的推断。"),
        ],
        boundary: b("只提供条件与风险证据，不决定剧情、人物选择或项目声音。"),
        potentialConflicts: [
          b("现实通行条件可能与已设定制度不一致，需交还用户决定。"),
        ],
        destination: b("研究/渡运条件.md"),
        sourceMode: "existing_materials",
        execution: {
          ...commonHandoff,
          resource_ids: [worldResource.id],
          kind: "consultant_brief",
          recipient: "waibu-zhishi-guwen",
          payload: {
            known: b("北岸封冻"),
            unknown: b("封冻期渡运的限制"),
            learning_goal: b("形成条件对照"),
            boundary: b("不决定剧情"),
            allowed_sources: [b("现有已授权世界资料")],
            destination: b("研究/渡运条件.md"),
          },
        },
      };
    case "expression_candidate":
      return {
        ...base,
        kind,
        role: "biaoxian-shejishi",
        approvalStage: "candidate",
        resource: expression,
        patches: [
          {
            kind: "create",
            resourceId: expression.id,
            path: expression.path,
            baseSha256: null,
            content: b(
              "# 抉择的动作\n\n用动作承载犹豫，让人物在具体选择中承担代价。\n",
            ),
            afterSha256: expression.sha256,
          },
        ],
        registryChanges: [
          {
            resourceId: expression.id,
            before: null,
            after: {
              ...expression,
              owner: "biaoxian-shejishi",
              version: "2",
              readers: ["biaoxian-shejishi"],
              allowAuthor: false,
              supersedes: null,
            },
          },
        ],
        closureAudit: {
          status: "passed",
          report: { path: b("校验/闭合审计.md"), sha256: b("f".repeat(64)) },
          checks: (
            [
              "route",
              "fulfillment",
              "mapping",
              "anchoring",
              "density",
              "proximity",
            ] as const
          ).map((category) => ({
            category,
            risk: "low",
            resolved: true,
            summary: b("演示检查已闭合，仍需独立的非正典试写和阅读。"),
          })),
        },
        trial: {
          status: "pending",
          report: null,
          sample: null,
          nonCanonical: true,
        },
      };
    case "generation_field": {
      const generationField = b<
        Extract<
          IdeationPreview,
          { kind: "generation_field" }
        >["generationField"]
      >(
        "林砚在北岸等到驿卒。南岸的求援信被放在桌上，封冻的河面仍横在两人之间。林砚必须在日落前给出答复，选择的代价留在行动里。",
      );
      return {
        ...base,
        kind,
        role: "zhangjie-qingjing-bianyiyuan",
        chapter: "2",
        generationField,
        characterCount: Array.from(generationField).length,
        lockedEvents: [b("驿卒抵达"), b("求援信交到林砚手中")],
        lockedOrder: [b("先抵达，后交信")],
        projection: {
          path: b("故事/章节情境/第2章.md"),
          sha256: b("e".repeat(64)),
        },
        approvedSources: [fixtureResource],
      };
    }
  }
}

/** Research outputs are evidence candidates, never silent story/Canon edits. */
export function researchFixture(
  base: Extract<IdeationPreview, { kind: "file_patch" }>,
): Extract<IdeationPreview, { kind: "file_patch" }> {
  const resource: IdeationResourceMetadata = {
    ...worldResource,
    id: b("research-ferry"),
    type: "evidence",
    status: "candidate",
    path: b("研究/渡运条件.md"),
    owner: "waibu-zhishi-guwen",
    readers: ["waibu-zhishi-guwen", "gushi-gousishi"],
    allowAuthor: false,
  };
  return {
    ...base,
    role: "waibu-zhishi-guwen",
    summary: b("封冻期渡运：条件与未确认事项"),
    explanation: b("只提交待批准的证据候选，不替用户决定正典、剧情或声音。"),
    patches: [
      {
        kind: "create",
        resourceId: resource.id,
        path: resource.path,
        baseSha256: null,
        content: b(
          "# 渡运条件\n\n## 已知\n封冻期暂停常规渡运。\n\n## 尚未确认\n冰况与绳索条件需进一步核对。\n",
        ),
        afterSha256: resource.sha256,
      },
    ],
    registryChanges: [
      { resourceId: resource.id, before: null, after: resource },
    ],
    resources: [worldResource],
  };
}

import { createHash } from "node:crypto";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { type InputManifest, packet, registry, state } from "@ruwen/core";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  CANDIDATE,
  MANIFEST,
  makeApproval,
  preparePacket,
  scope,
  temporaryProject,
} from "../../core/test/helpers.ts";
import { defaultFauxResponse, fauxOutput } from "../src/faux.ts";
import {
  createFauxRuntime,
  FAUX_PROSE,
  ROLE_IDS,
  readAuthorizedResource,
  runRole,
} from "../src/index.ts";
import { decodeUserMessage, unescapeTaggedMaterial } from "../src/messages.ts";
import { deploymentCanary } from "../src/security/notes.ts";
import type { Data, RoleId } from "../src/types.ts";

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const prose = FAUX_PROSE;
const storyId = "gushi-dangqian-hu";
const situationId = "shijie-dangqian-taishi";
const resourceTitle = "本章可读的当前态势";
let project: Awaited<ReturnType<typeof temporaryProject>>;
let compiled: Awaited<ReturnType<typeof packet.compilePacket>>;
let hardRules: Data;
beforeAll(async () => {
  project = await temporaryProject();
  const { fs } = project;
  await preparePacket(fs);
  const index = await registry.readRegistry(fs);
  const situation = index.resources.find(({ id }) => id === situationId);
  if (!situation) throw new Error("Missing fixture resource");
  situation.title = resourceTitle;
  await fs.write(registry.REGISTRY, JSON.stringify(index));
  compiled = await packet.compilePacket(fs, MANIFEST);
  hardRules = await readAuthorizedResource(
    { fs, projectKey: "test-project", runtime: createFauxRuntime() },
    "xianshi-heyanyuan",
    "xiaoyan-yingsheding",
  );
  await fs.write(CANDIDATE, prose);
  const event = await makeApproval(
    fs,
    CANDIDATE,
    "candidate_approve",
    "manifest-prose",
  );
  await state.recordApproved(fs, CANDIDATE, "v1", event);
  await state.promoteApproved(fs, "chapters/001.md");
});
afterAll(async () => {
  await project?.cleanup();
});

const delegated = {
  brief: { creative_value: "核对故事材料" },
  scope: scope() as Data,
};
const storyRef = { id: storyId };
const situationRef = { id: situationId };
function roleInput(role: RoleId): Data {
  switch (role) {
    case "chuangyi-xietiaoyuan":
      return {
        raw_user_text: "我想写一章。",
        conversation: [{ role: "user", content: "我想写一章。" }],
        project_state: { project: "test-project" },
      };
    case "xiangmu-zhiliyuan":
    case "gushi-gousishi":
    case "waibu-zhishi-guwen":
      return { ...delegated, resource_ids: [storyId] };
    case "biaoxian-shejishi":
      return { ...delegated, approved_resources: [{ id: "shijie-zongbiao" }] };
    case "zhangjie-qingjing-bianyiyuan":
      return {
        chapter: "001",
        scope: scope() as Data,
        resources: [storyRef],
        locked_events: ["粮车先离开"],
      };
    case "xiaoshuo-zuozhe":
      return { packet: compiled.message };
    case "qinggan-duzhe":
      return {
        prose,
        chapter: "001",
        previous_tail: `前情不入本次输入${"末".repeat(600)}`,
      };
    case "wenxue-bianji":
      return { prose, reading: fauxOutput("qinggan-duzhe", { prose }) };
    case "qingjie-heyanyuan":
      return {
        prose,
        locked_events: ["粮车先离开"],
        locked_order: ["先等马，再送信"],
      };
    case "xianshi-heyanyuan":
      return { prose, hard_rules: [hardRules] };
    case "jiyi-weihuyuan":
      return { approved_prose: prose, resources: [situationRef] };
  }
}

const withheldFixtures: Record<string, string> = {
  translated_delegation: "brief",
  raw_user_wording: "original_wording",
  literary_ledger_details: "literary_details",
  full_character_profiles: "character_profile",
  world_materials: "world",
  story_outline: "outline",
  research: "research",
  governance: "governance",
  validation: "validation",
  literary_ledger: "literary_ledger",
  later_role_opinions: "later_opinions",
  source_list: "source_list",
  checklists: "checklists",
  full_literary_checklist: "checklist",
  reader_reactions: "reading",
  editor_edits: "edits",
  unapproved_prose: "draft_prose",
  unapproved_inferences: "draft_inferences",
};
const sentinel = (category: string) => `PRIVATE_MANIFEST_${category}_END`;

function textOf(
  content: TranscriptContext["messages"][number]["content"],
): string {
  return typeof content === "string"
    ? content
    : content
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("");
}

function collectStrings(value: unknown, result: string[]): void {
  if (typeof value === "string") result.push(value);
  else if (value && typeof value === "object")
    for (const child of Object.values(value)) collectStrings(child, result);
}

it.each(
  ROLE_IDS,
)("%s manifest describes the actual faux request and excludes withheld sentinels", async (role) => {
  const requests: TranscriptContext[] = [];
  const capture: typeof defaultFauxResponse = (request) => {
    requests.push(structuredClone(request));
    if (role === "wenxue-bianji" && requests.length === 1)
      return fauxAssistantMessage(
        fauxToolCall("load_diagnostic", { name: "explanation" }),
        { stopReason: "toolUse" },
      );
    return defaultFauxResponse(request);
  };
  const input = roleInput(role);
  // Runtime guards reject forbidden fields at admission; the whitelist handles the remaining fields.
  const denied = Object.fromEntries(
    Object.entries(withheldFixtures)
      .filter(
        ([category, key]) =>
          !Object.hasOwn(input, key) &&
          !(
            role === "chuangyi-xietiaoyuan" &&
            category === "translated_delegation"
          ),
      )
      .map(([category, key]) => [key, sentinel(category)]),
  );
  const stored: InputManifest[] = [];
  const runtime = createFauxRuntime(Array.from({ length: 8 }, () => capture));
  const result = await runRole(
    role,
    { ...denied, ...input },
    {
      fs: project.fs,
      projectKey: "test-project",
      runtime,
      ...(role === "xiaoshuo-zuozhe"
        ? { authorPacketManifest: compiled.manifest }
        : {}),
      ...(role === "chuangyi-xietiaoyuan"
        ? {
            loadCoordinatorInput: async () => ({
              ...input,
              raw_user_text: "从已授权会话重新载入的表达。",
            }),
          }
        : {}),
      onInputManifest: async (manifest) => {
        stored.push(structuredClone(manifest));
      },
    },
  );
  const manifest = result.inputManifest;
  if (!manifest) throw new Error("Missing recorded manifest");
  expect(stored.at(-1)).toEqual(manifest);
  expect(requests.length).toBeGreaterThan(0);
  expect(manifest.withheld.length).toBeGreaterThan(0);
  expect(JSON.stringify(manifest)).not.toContain(deploymentCanary());
  expect(JSON.stringify(manifest)).not.toContain("ruwen-faux");
  expect(Object.keys(manifest.rules).sort()).toEqual([
    "chars",
    "upstreamFileCount",
  ]);
  const wire = requests.flatMap((request) =>
    request.messages
      .filter(
        ({ role: messageRole }) =>
          messageRole === "user" || messageRole === "toolResult",
      )
      .map(({ content }) => textOf(content)),
  );
  for (const { category, ruleRef } of manifest.withheld) {
    expect(ruleRef).not.toBe("");
    expect(JSON.stringify(requests)).not.toContain(sentinel(category));
  }
  const material: string[] = [];
  for (const message of wire) {
    const serialized = unescapeTaggedMaterial(message);
    if (role === "xiaoshuo-zuozhe") {
      expect(message).toBe(compiled.message);
      for (const { path } of compiled.manifest.seen) {
        if (!path) throw new Error("Missing compiled packet source");
        const text = (await project.fs.readText(path))
          .replace(/\r\n?/g, "\n")
          .trim();
        expect(message).toContain(text);
        material.push(text);
      }
    } else {
      const decoded = decodeUserMessage(message);
      if (decoded) collectStrings(decoded, material);
      else if (serialized.startsWith("{"))
        collectStrings(JSON.parse(serialized), material);
    }
  }
  for (const item of manifest.seen) {
    if (item.sha256)
      expect(
        material.some(
          (text) =>
            sha256(text) === item.sha256 &&
            Array.from(text).length === item.chars,
        ),
        `request match for ${item.label}`,
      ).toBe(true);
  }
  if (role === "wenxue-bianji")
    expect(manifest.seen).toContainEqual(
      expect.objectContaining({
        kind: "diagnostic",
        includedBecause: "tool_call",
      }),
    );
  if (role === "jiyi-weihuyuan") {
    expect(manifest.seen).toContainEqual(
      expect.objectContaining({
        label: resourceTitle,
        resourceId: situationId,
        includedBecause: "tool_call",
      }),
    );
    expect(
      stored[0]?.seen.filter(
        ({ includedBecause }) => includedBecause === "tool_call",
      ),
    ).toHaveLength(0);
  }
  if (role === "qinggan-duzhe")
    expect(manifest.seen).toContainEqual(
      expect.objectContaining({
        kind: "chapter_tail",
        chars: 600,
        truncated: true,
      }),
    );
  if (role === "chuangyi-xietiaoyuan") {
    expect(wire[0]).toContain("从已授权会话重新载入的表达。");
    expect(manifest.seen[0]?.chars).toBe(
      Array.from("从已授权会话重新载入的表达。").length,
    );
  }
  expect(manifest).toMatchSnapshot();
});

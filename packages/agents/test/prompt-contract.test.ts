import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { packet, state } from "@ruwen/core";
import { expect, it } from "vitest";
import {
  CANDIDATE,
  makeApproval,
  preparePacket,
  temporaryProject,
} from "../../core/test/helpers.ts";
import { defaultFauxResponse } from "../src/faux.ts";
import {
  assemblePrompt,
  createFauxRuntime,
  ROLE_IDS,
  ROLES,
  type RoleId,
  runRole,
} from "../src/index.ts";
import {
  defaultUpstreamRoot,
  PLATFORM_NOTE,
  PLUGIN,
  skillRoot,
} from "../src/prompts/manifest.ts";
import { securityNote } from "../src/security/notes.ts";

const source = async (p: string) =>
  (await readFile(path.join(defaultUpstreamRoot, p), "utf8")).replace(
    /\r\n?/g,
    "\n",
  );
it.each(
  ROLE_IDS.filter((id) => !["xiaoshuo-zuozhe", "qinggan-duzhe"].includes(id)),
)("%s admits every reference file discovered independently from upstream", async (id) => {
  const root = skillRoot(id),
    directory = path.join(defaultUpstreamRoot, root, "references");
  const actual = (await readdir(directory, { recursive: true })).filter(
    (name) =>
      !name
        .replaceAll("\\", "/")
        .split("/")
        .some((part) => ["roles", "diagnostics"].includes(part)),
  );
  const { stat } = await import("node:fs/promises");
  for (const name of actual)
    if ((await stat(path.join(directory, name))).isFile())
      expect(
        ROLES[id].promptFiles.some(
          (file) =>
            file.path === `${root}/references/${name.replaceAll("\\", "/")}`,
        ),
      ).toBe(true);
});
it.each(
  ROLE_IDS,
)("%s contains every admitted file as an untouched, ordered complete substring", async (id) => {
  const spec = ROLES[id],
    prompt = (await assemblePrompt(spec)).content;
  let previous = -1;
  for (const file of spec.promptFiles) {
    if (file.section) continue;
    const raw = await source(file.path);
    const position = prompt.indexOf(raw);
    expect(position, file.path).toBeGreaterThan(previous);
    previous = position;
  }
  expect(
    prompt.includes(
      `${spec.output.kind === "text" ? "只输出候选正文，不输出说明。" : `最终结果必须调用 ${spec.output.toolName} 提交；不得仅用普通消息代替。`}\n`,
    ),
  ).toBe(true);
  expect(prompt.endsWith(`\n${securityNote(id)}`)).toBe(true);
  expect(prompt.indexOf(PLATFORM_NOTE)).toBeGreaterThan(previous);
  if (!["xiaoshuo-zuozhe", "qinggan-duzhe"].includes(id)) {
    expect(prompt.startsWith(await source(`${skillRoot(id)}/SKILL.md`))).toBe(
      true,
    );
    expect(spec.promptFiles.at(-1)?.path.endsWith(`/roles/${id}.md`)).toBe(
      true,
    );
  }
});
it.each(
  ROLE_IDS,
)("%s does not load another role file or the diagnostic pack", async (id) => {
  const prompt = (await assemblePrompt(ROLES[id])).content;
  for (const other of ROLE_IDS)
    if (other !== id)
      expect(prompt).not.toContain(
        await source(`${skillRoot(other)}/references/roles/${other}.md`),
      );
  expect(
    ROLES[id].promptFiles.some((file) => file.path.includes("/diagnostics/")),
  ).toBe(false);
});
it.each([
  "xiaoshuo-zuozhe",
  "qinggan-duzhe",
] as RoleId[])("%s excludes SKILL, references and shared contract source from system and input", async (id) => {
  const prompt = (await assemblePrompt(ROLES[id])).content;
  const input = ROLES[id].buildUserMessage({
    packet: "当前作者资料包",
    prose: "当前正文",
    chapter: "001",
    previous_tail: "尾部",
    brief: { secret: "委托" },
    outline: "大纲",
    reading: { secret: "后续意见" },
  });
  for (const skill of ["ruwen-gushi-gousi", "ruwen-zhangjie-xiezuo"])
    expect(prompt + input).not.toContain(
      await source(`${PLUGIN}/skills/${skill}/SKILL.md`),
    );
  for (const name of [
    "information-contract",
    "creative-communication-contract",
  ])
    expect(prompt + input).not.toContain(
      await source(`${PLUGIN}/shared/${name}.md`),
    );
  for (const other of ROLE_IDS.filter(
    (role) => !["xiaoshuo-zuozhe", "qinggan-duzhe"].includes(role),
  ))
    for (const file of ROLES[other].promptFiles.filter(
      (file) =>
        file.path.includes("/references/") && !file.path.includes("/roles/"),
    ))
      expect(prompt + input).not.toContain(await source(file.path));
  expect(input).not.toMatch(/委托|大纲|后续意见/);
});
it("author core occurs once in the system and once in its compiled packet by explicit human decision", async () => {
  const core = packet.loadAuthorCore();
  const system = (await assemblePrompt(ROLES["xiaoshuo-zuozhe"])).content;
  expect(system.split(core)).toHaveLength(2);
  const project = await temporaryProject();
  try {
    const p = await preparePacket(project.fs);
    expect(
      (await project.fs.readText(p)).replace(/\r\n?/g, "\n").split(core),
    ).toHaveLength(2);
  } finally {
    await project.cleanup();
  }
});
const visibility: [RoleId, string[], string[]][] = [
  [
    "xiaoshuo-zuozhe",
    ["packet"],
    [
      "prose",
      "reading",
      "brief",
      "outline",
      "research",
      "governance",
      "ledger",
      "sources",
    ],
  ],
  [
    "qinggan-duzhe",
    ["prose", "chapter", "previous_tail"],
    ["packet", "outline", "locked_events", "hard_rules", "reading", "sources"],
  ],
  [
    "wenxue-bianji",
    ["prose", "reading"],
    ["brief", "packet", "outline", "governance", "sources"],
  ],
  [
    "qingjie-heyanyuan",
    ["prose", "locked_events", "locked_order"],
    [
      "reading",
      "brief",
      "hard_rules",
      "packet",
      "writing_rules",
      "editor_complaints",
    ],
  ],
  [
    "xianshi-heyanyuan",
    ["prose", "hard_rules"],
    [
      "reading",
      "brief",
      "locked_events",
      "packet",
      "writing_rules",
      "editor_complaints",
    ],
  ],
];
it.each(
  visibility,
)("writing SKILL visibility for %s is enforced by input construction", (id, allowed, denied) => {
  const fields = Object.fromEntries(
    [...allowed, ...denied].map((field) => [field, `SENTINEL_${field}`]),
  );
  const message = ROLES[id].buildUserMessage(fields);
  for (const field of allowed) expect(message).toContain(`SENTINEL_${field}`);
  for (const field of denied)
    expect(message).not.toContain(`SENTINEL_${field}`);
});
it.each(
  ROLE_IDS.filter((id) => id !== "chuangyi-xietiaoyuan"),
)("concept SKILL double-input rule rejects raw dialogue in %s", (id) => {
  expect(() =>
    ROLES[id].buildUserMessage({ raw_user_text: "原话", brief: { fixed: [] } }),
  ).toThrow("Raw user");
});
it("pi cacheRetention is explicitly enabled and unchanged system prefix survives a correction", async () => {
  const project = await temporaryProject();
  try {
    const modes: unknown[] = [];
    const prefixes: string[] = [];
    const runtime = createFauxRuntime([
      (context, options) => {
        modes.push(options?.cacheRetention);
        prefixes.push(
          JSON.stringify(
            context.messages.filter((message) => message.role === "system"),
          ),
        );
        return {
          ...defaultFauxResponse(context),
          content: [{ type: "text", text: "missing submission" }],
          stopReason: "stop",
        };
      },
      (context, options) => {
        modes.push(options?.cacheRetention);
        prefixes.push(
          JSON.stringify(
            context.messages.filter((message) => message.role === "system"),
          ),
        );
        return defaultFauxResponse(context);
      },
    ]);
    const result = await runRole(
      "qinggan-duzhe",
      { prose: "读者看到的正文。" },
      { fs: project.fs, projectKey: "test-project", runtime },
    );
    expect(modes).toEqual(["long", "long"]);
    expect(prefixes).toHaveLength(2);
    expect(prefixes[1]).toBe(prefixes[0]);
    expect(result.usage[1]?.cacheRead).toBeGreaterThan(0);
  } finally {
    await project.cleanup();
  }
});
it("memory receives only approved prose and canonical metadata; unapproved candidates and inferences are rejected", async () => {
  const project = await temporaryProject();
  try {
    const fs = project.fs;
    await preparePacket(fs);
    await fs.write(CANDIDATE, "已批准的正文。");
    const event = await makeApproval(
      fs,
      CANDIDATE,
      "candidate_approve",
      "memory-visible-only",
    );
    await state.recordApproved(fs, CANDIDATE, "v1", event);
    await state.promoteApproved(fs, "chapters/001.md");
    const captured: string[] = [];
    await runRole(
      "jiyi-weihuyuan",
      {
        approved_prose: "已批准的正文。",
        resources: [
          { id: "shijie-zongbiao", content: "UNAPPROVED_INFERENCE_SENTINEL" },
        ],
      },
      {
        fs,
        projectKey: "test-project",
        runtime: createFauxRuntime(),
        onRequest: (context) => captured.push(JSON.stringify(context)),
      },
    );
    expect(captured[0]).not.toContain("UNAPPROVED_INFERENCE_SENTINEL");
    expect(captured[0]).toContain("world");
    for (const key of ["candidate_prose", "candidate_inferences"])
      await expect(
        runRole(
          "jiyi-weihuyuan",
          {
            approved_prose: "已批准的正文。",
            resources: [],
            [key]: "未批准候选推断。",
          },
          { fs, projectKey: "test-project", runtime: createFauxRuntime() },
        ),
      ).rejects.toThrow("Unapproved");
    await expect(
      runRole(
        "jiyi-weihuyuan",
        { approved_prose: "未批准候选稿。", resources: [] },
        { fs, projectKey: "test-project", runtime: createFauxRuntime() },
      ),
    ).rejects.toThrow("approved chapter");
  } finally {
    await project.cleanup();
  }
});

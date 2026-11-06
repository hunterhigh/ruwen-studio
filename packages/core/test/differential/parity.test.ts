import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { CHECK_NAMES } from "../../src/checks/index.ts";
import { LocalDirFS } from "../../src/fs/local-dir-fs.ts";
import { REGISTRY, readRegistry } from "../../src/registry/index.ts";
import {
  type ObjectData,
  readJson,
  writeJson,
  writeText,
} from "../../src/runtime.ts";
import {
  CANDIDATE,
  FIELD,
  MANIFEST,
  makeApproval,
  makeReady,
  PROJECTION,
  preparePacket,
  scope,
} from "../helpers.ts";

const workspace = fileURLToPath(new URL("../../../../", import.meta.url));
const upstream = path.join(workspace, "vendor/ruwen");
const cli = fileURLToPath(new URL("../../bin/ruwen-core.ts", import.meta.url));
const clock = new URL("fixed-clock.mjs", import.meta.url).href;
const python = process.env.PYTHON_BIN ?? "python";
let exported: string;
let scripts: string;
let parent: string;
let fs: LocalDirFS;
beforeAll(async () => {
  exported = await mkdtemp(path.join(tmpdir(), "ruwen-oracle-"));
  const archive = execFileSync(
    "git",
    ["-C", upstream, "archive", "HEAD", "01-完整插件/ruwen-xiezuo-xitong"],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const archiveFile = path.join(exported, "upstream.tar");
  await writeFile(archiveFile, archive);
  execFileSync(
    python,
    [
      "-I",
      "-B",
      "-c",
      "import sys,tarfile; t=tarfile.open(sys.argv[1]); t.extractall(sys.argv[2],filter='data')",
      archiveFile,
      exported,
    ],
    { windowsHide: true },
  );
  scripts = path.join(exported, "01-完整插件/ruwen-xiezuo-xitong/scripts");
});
afterAll(async () => {
  await rm(exported, { recursive: true, force: true });
});
beforeEach(async () => {
  parent = await mkdtemp(path.join(tmpdir(), "ruwen-diff-"));
  fs = new LocalDirFS(path.join(parent, "project"));
});
afterEach(async () => {
  await rm(parent, { recursive: true, force: true });
});
async function snapshot(): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const p of await fs.list()) files.set(p, Buffer.from(await fs.read(p)));
  return files;
}
async function restore(files: Map<string, Buffer>) {
  // The fixed absolute project path is shared sequentially so embedded paths and hashes compare exactly.
  expect(path.dirname(fs.root)).toBe(parent);
  await rm(fs.root, { recursive: true, force: true });
  await mkdir(fs.root);
  for (const [p, bytes] of files) {
    const destination = path.join(fs.root, p);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
}
async function step(module: string, args: string[], stdin = "") {
  const before = await snapshot();
  const oracleArgs = [
    "-I",
    "-B",
    fileURLToPath(new URL("python-oracle.py", import.meta.url)),
    scripts,
    module,
    ...args,
  ];
  const expected = spawnSync(python, oracleArgs, {
    encoding: "utf8",
    input: stdin,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      PYTHONUTF8: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONHASHSEED: "0",
    },
  });
  expect(expected.error, expected.stderr).toBeUndefined();
  const expectedFiles = await snapshot();
  await restore(before);
  const runner =
    module === "approval-api"
      ? fileURLToPath(new URL("ts-approval-runner.ts", import.meta.url))
      : cli;
  const actual = spawnSync(
    process.execPath,
    [
      "--import",
      clock,
      runner,
      ...(module === "approval-api" ? [] : [module]),
      ...args,
    ],
    {
      encoding: "utf8",
      input: stdin,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );
  expect(actual.error, actual.stderr).toBeUndefined();
  expect(
    actual.status,
    `${module}\nPY: ${expected.stderr}\nTS: ${actual.stderr}`,
  ).toBe(expected.status);
  const output = (value: string) => (value.trim() ? JSON.parse(value) : null);
  expect(output(actual.stdout), `${module} stdout`).toEqual(
    output(expected.stdout),
  );
  const actualFiles = await snapshot();
  expect([...actualFiles.keys()], `${module} file names`).toEqual([
    ...expectedFiles.keys(),
  ]);
  for (const [p, bytes] of expectedFiles)
    expect(actualFiles.get(p), `${module}: exact bytes at ${p}`).toEqual(bytes);
  return output(actual.stdout) as ObjectData | null;
}
const root = () => ["--project-root", fs.root];
const initialize = () =>
  step("init_project", [...root(), "--project-id", "test-project"]);

describe("Python ↔ TypeScript CLI / filesystem differential", () => {
  it("every resource lifecycle edge has the same result and byte effects", async () => {
    await initialize();
    await makeReady(fs);
    const base = await snapshot();
    for (const from of [
      "proposed",
      "candidate",
      "active",
      "superseded",
      "retired",
    ]) {
      for (const to of [
        "proposed",
        "candidate",
        "active",
        "superseded",
        "retired",
      ]) {
        await restore(base);
        const data = await readRegistry(fs);
        const item = data.resources.find((r) => r.id === "xiangmu-zhangcheng");
        if (!item) throw new Error("fixture");
        item.status = from;
        await writeJson(fs, REGISTRY, data);
        const args = [
          "transition",
          ...root(),
          "--resource-id",
          item.id,
          "--status",
          to,
        ];
        if (to === "active") {
          const event = await makeApproval(
            fs,
            item.path,
            "resource_activate",
            `edge-${from}-${to}`,
          );
          args.push("--approved-by-user", "--approval-event", event);
        }
        await step("resource_registry", args);
      }
    }
  }, 60_000);
  it("closure auditing and technical audit append agree on JSON and bytes", async () => {
    await initialize();
    const p = "表现/能力/audit.md";
    await writeText(fs, p, "叙述距离随人物可确认的信息变化。");
    const review = {
      resource_id: "audit-resource",
      resource_path: fs.displayPath(p),
      resource_version: "1.0.0",
      resource_sha256: await fs.sha256(p),
      reviewed_by: "user",
      checks: Object.fromEntries(CHECK_NAMES.map((k) => [k, "pass"])),
    };
    await writeJson(fs, "manual.json", review);
    const args = [
      "--file",
      fs.displayPath(p),
      "--resource-id",
      "audit-resource",
      "--resource-version",
      "1.0.0",
      "--manual-review",
      fs.displayPath("manual.json"),
      "--output",
      fs.displayPath("closure-result.json"),
    ];
    await step("closure_audit", args);
    await writeText(
      fs,
      p,
      "政治就是对白。例如先问账目，然后展示绳结，最后沉默。",
    );
    review.resource_sha256 = await fs.sha256(p);
    await writeJson(fs, "manual.json", review);
    await step("closure_audit", args);
    const audit = {
      role: "xiangmu-zhiliyuan",
      resource_ids: ["audit-resource"],
      change: "resource_reviewed",
      scope: {
        project: "test-project",
        volume: null,
        arc: null,
        chapter: null,
      },
      conflict_category: null,
      approval_status: "approved",
      result: "review_complete",
    };
    await writeJson(fs, "audit-entry.json", audit);
    await step("audit_ledger", [
      ...root(),
      "--event-json",
      fs.displayPath("audit-entry.json"),
    ]);
  }, 60_000);
  it("init → registry validation → readiness → scope selection", async () => {
    await initialize();
    await step("resource_registry", ["validate", ...root()]);
    await step("project_readiness", root());
    await makeReady(fs);
    await step("project_readiness", root());
    await step("resource_registry", [
      "select",
      ...root(),
      "--project",
      "test-project",
      "--pov",
      "主角",
      "--author-only",
    ]);
    await step("governance_check", root());
  }, 60_000);
  it("all legal lifecycle edges, activation approval, retirement and illegal transitions", async () => {
    await initialize();
    await step("resource_registry", [
      "transition",
      ...root(),
      "--resource-id",
      "xiangmu-zhangcheng",
      "--status",
      "candidate",
    ]);
    await step("resource_registry", [
      "transition",
      ...root(),
      "--resource-id",
      "xiangmu-zhangcheng",
      "--status",
      "active",
    ]);
    const event = await makeApproval(
      fs,
      "项目/项目章程.md",
      "resource_activate",
      "activate-charter",
    );
    await step("resource_registry", [
      "transition",
      ...root(),
      "--resource-id",
      "xiangmu-zhangcheng",
      "--status",
      "active",
      "--approved-by-user",
      "--approval-event",
      event,
    ]);
    await step("resource_registry", [
      "transition",
      ...root(),
      "--resource-id",
      "xiangmu-zhangcheng",
      "--status",
      "retired",
    ]);
    await step("resource_registry", [
      "transition",
      ...root(),
      "--resource-id",
      "xiangmu-zhangcheng",
      "--status",
      "active",
    ]);
    await step("resource_registry", [
      "transition",
      ...root(),
      "--resource-id",
      "zhujue-dangan",
      "--status",
      "retired",
    ]);
  }, 60_000);
  it("approval creation, reserve, contention, rollback, commit and duplicate consumption", async () => {
    await initialize();
    const target = "治理/交接/target.json";
    await fs.write(target, "{}");
    const created = await step("approval_record", [
      ...root(),
      "--event-id",
      "diff-approval",
      "--action",
      "handoff_execute",
      "--target",
      target,
      "--confirmed-by-user",
    ]);
    const event = String(created?.event);
    await step("approval-api", ["reserve", fs.root, event]);
    await step("approval-api", ["reserve", fs.root, event]);
    await step("approval-api", ["rollback", fs.root, event]);
    await step("approval-api", ["reserve", fs.root, event]);
    await step("approval-api", ["commit", fs.root, event]);
    await step("approval-api", ["consume", fs.root, event]);
  }, 60_000);
  it("state init/register/compile/check produces byte-identical packet and metadata", async () => {
    await initialize();
    await makeReady(fs);
    await step("story_state", [
      "init",
      ...root(),
      "--outline",
      "故事/当前故事弧.md",
      "--source",
      "character=人物/主角档案.md",
      "--source",
      "world=世界/世界总表.md",
      "--source",
      "situation=世界/当前态势.md",
    ]);
    await step("story_state", ["check", ...root()]);
    await writeText(fs, PROJECTION, FIELD);
    await writeJson(fs, "scope.json", scope());
    await step("story_state", [
      "register-projection",
      ...root(),
      "--projection",
      PROJECTION,
      "--chapter",
      "001",
      "--scope-file",
      "scope.json",
    ]);
    const manifest = await readJson(fs, MANIFEST);
    manifest.context_scope = scope();
    await writeJson(fs, MANIFEST, manifest);
    await step("compile_author_packet", [
      "compile",
      ...root(),
      "--manifest",
      MANIFEST,
    ]);
    await step("compile_author_packet", [
      "check",
      ...root(),
      "--packet",
      "authoring-ruwen-v5/packets/current.md",
    ]);
  }, 60_000);
  it("packet budget, candidate sources and changed hashes reject without artifacts", async () => {
    await initialize();
    await preparePacket(fs);
    const baseline = await snapshot();
    const data = await readJson(fs, "治理/资源注册表.json");
    const items = data.resources as ObjectData[];
    const voice = items.find((x) => x.id === "biaoxian-xiangmu-shengyin");
    if (!voice) throw new Error("fixture");
    voice.status = "candidate";
    await writeJson(fs, "治理/资源注册表.json", data);
    await step("compile_author_packet", [
      "compile",
      ...root(),
      "--manifest",
      MANIFEST,
    ]);
    await restore(baseline);
    await writeText(fs, "表现/项目声音.md", "changed");
    await step("compile_author_packet", [
      "compile",
      ...root(),
      "--manifest",
      MANIFEST,
    ]);
    await restore(baseline);
    const manifest = await readJson(fs, MANIFEST);
    manifest.user_authored_text = {
      path: "authoring-ruwen-v5/exact-text/long.md",
      confirmed_verbatim: true,
    };
    await writeJson(fs, MANIFEST, manifest);
    await writeText(
      fs,
      "authoring-ruwen-v5/exact-text/long.md",
      "字".repeat(601),
    );
    await step("compile_author_packet", [
      "compile",
      ...root(),
      "--manifest",
      MANIFEST,
    ]);
  }, 60_000);
  it("approved candidate → replacement archive → memory gate → reconcile", async () => {
    await initialize();
    await preparePacket(fs);
    const target = "chapters/chapter-001.md";
    await writeText(fs, target, "旧正文");
    await writeText(fs, CANDIDATE, "粮车先出了驿门。");
    const event = await makeApproval(
      fs,
      CANDIDATE,
      "candidate_approve",
      "diff-candidate",
    );
    await step("story_state", [
      "record-approved",
      ...root(),
      "--prose",
      CANDIDATE,
      "--version",
      "candidate-1",
      "--approval-event",
      event,
    ]);
    await step("story_state", [
      "promote-approved",
      ...root(),
      "--target",
      target,
    ]);
    await step("story_state", [
      "promote-approved",
      ...root(),
      "--target",
      target,
      "--replace-existing",
      "--expected-target-sha256",
      await fs.sha256(target),
    ]);
    await step("story_state", ["reconcile", ...root()]);
    const preview = "authoring-ruwen-v5/reports/memory.json";
    await writeJson(fs, preview, { changes: [] });
    const memory = await makeApproval(
      fs,
      preview,
      "memory_commit",
      "diff-memory",
    );
    await step("story_state", [
      "reconcile",
      ...root(),
      "--memory-preview",
      preview,
      "--memory-approval-event",
      memory,
    ]);
    await step("story_state", ["check", ...root()]);
  }, 60_000);
  it("handoff creation-check, execution and repeated approval", async () => {
    await initialize();
    const payload = {
      known: "驿道冬季运作",
      unknown: "换马的现实边界",
      learning_goal: "补足物质条件",
      boundary: "只调查交通制度",
      allowed_sources: ["权威史料"],
      destination: "研究/交通制度.md",
    };
    const target = "治理/交接/consultant.json";
    await writeJson(fs, target, payload);
    const event = await makeApproval(
      fs,
      target,
      "handoff_execute",
      "diff-handoff",
    );
    const value: ObjectData = {
      kind: "consultant_brief",
      sender: "chuangyi-xietiaoyuan",
      recipient: "waibu-zhishi-guwen",
      resource_ids: [],
      scope: { project: "test-project" },
      approval_ref: { path: event, sha256: await fs.sha256(event) },
      payload,
    };
    await writeJson(fs, "handoff.json", value);
    await step(
      "handoff_validator",
      ["--file", fs.displayPath("handoff.json"), "--creation-check"],
      "请调查冬季交通制度对普通人出行的影响，不要编写人物心理。",
    );
    await step("handoff_validator", [
      "--file",
      fs.displayPath("handoff.json"),
      "--for-execution",
      ...root(),
    ]);
    await step("handoff_validator", [
      "--file",
      fs.displayPath("handoff.json"),
      "--for-execution",
      ...root(),
    ]);
  }, 60_000);
  it("schema migration preview/apply and append-only ledger summaries", async () => {
    await initialize();
    await preparePacket(fs);
    const old = await readJson(fs, "authoring-ruwen-v5/state.json");
    old.schema_version = "1.2";
    delete old.pending_approved_candidate;
    delete old.approval_history;
    delete old.consumed_approval_ids;
    await writeJson(fs, "authoring-ruwen-v5/state.json", old);
    await step("story_state", ["migrate-state", ...root(), "--check"]);
    await step("story_state", ["migrate-state", ...root(), "--apply"]);
    const entry = {
      location: "候选段落",
      category: "解释重复动作",
      condition: "关系场景",
      handling: "删除",
      result: "待用户评估",
      task_id: "t1",
      status: "open",
    };
    await writeJson(fs, "problem.json", entry);
    await step("problem_ledger", [
      "append",
      ...root(),
      "--entry-json",
      fs.displayPath("problem.json"),
    ]);
    await step("problem_ledger", ["summary", ...root()]);
  }, 60_000);
});

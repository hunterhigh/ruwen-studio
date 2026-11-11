import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as approval from "../src/approval/index.ts";
import * as checks from "../src/checks/index.ts";
import { LocalDirFS } from "../src/fs/local-dir-fs.ts";
import * as handoff from "../src/handoff/index.ts";
import { initProject } from "../src/init/index.ts";
import * as ledgers from "../src/ledgers/index.ts";
import {
  previewV41Directory,
  writeV41PreviewReport,
} from "../src/migration/local-preview.ts";
import * as packet from "../src/packet/index.ts";
import * as registry from "../src/registry/index.ts";
import {
  CoreError,
  type ObjectData,
  pyJson,
  readJson,
  requireFile,
  writeText,
} from "../src/runtime.ts";
import * as state from "../src/state/index.ts";

const flags: Record<
  string,
  { strings: string[]; booleans: string[]; commands?: string[] }
> = {
  "resource-registry": {
    strings: [
      "project-root",
      "project",
      "volume",
      "arc",
      "chapter",
      "scene-type",
      "pov",
      "resource-id",
      "status",
      "approval-event",
      "closure-audit",
      "trial-report",
    ],
    booleans: ["author-only", "approved-by-user"],
    commands: ["validate", "select", "transition", "refresh-hash"],
  },
  "approval-record": {
    strings: ["project-root", "event-id", "action", "target"],
    booleans: ["confirmed-by-user"],
  },
  "audit-ledger": { strings: ["project-root", "event-json"], booleans: [] },
  "problem-ledger": {
    strings: ["project-root", "entry-json"],
    booleans: [],
    commands: ["append", "summary"],
  },
  "story-state": {
    strings: [
      "project-root",
      "outline",
      "source",
      "last-approved",
      "rewrite-cutoff",
      "snapshot-root",
      "projection",
      "chapter",
      "scope-file",
      "prose",
      "version",
      "approval-event",
      "target",
      "expected-target-sha256",
      "memory-preview",
      "memory-approval-event",
    ],
    booleans: ["replace-existing", "check", "apply", "clear-rewrite-snapshot"],
    commands: [
      "init",
      "check",
      "register-projection",
      "record-approved",
      "promote-approved",
      "migrate-state",
      "reconcile",
    ],
  },
  "compile-author-packet": {
    strings: ["project-root", "manifest", "packet"],
    booleans: [],
    commands: ["compile", "check"],
  },
  "handoff-validator": {
    strings: ["file", "project-root"],
    booleans: ["for-execution", "creation-check"],
  },
  "project-readiness": { strings: ["project-root"], booleans: [] },
  "governance-check": { strings: ["project-root"], booleans: [] },
  "closure-audit": {
    strings: [
      "file",
      "resource-id",
      "resource-version",
      "manual-review",
      "output",
      "project-root",
    ],
    booleans: [],
  },
  "init-project": { strings: ["project-root", "project-id"], booleans: [] },
  "migrate-v4-1-preview": { strings: ["project-root", "output"], booleans: [] },
};
const aliases: Record<string, string> = {
  registry: "resource-registry",
  approval: "approval-record",
  state: "story-state",
  packet: "compile-author-packet",
  readiness: "project-readiness",
  governance: "governance-check",
  closure: "closure-audit",
  init: "init-project",
};

export async function main(args: string[]): Promise<number> {
  const rawModule =
    args.shift()?.replace(/\.py$/, "").replaceAll("_", "-") ?? "";
  if (!rawModule || ["--help", "-h"].includes(rawModule)) {
    console.log(
      `ruwen-core <${Object.keys(flags).join("|")}> [command] [options]`,
    );
    return 0;
  }
  const module = aliases[rawModule] ?? rawModule;
  const spec = flags[module];
  if (!spec) throw new CoreError(`Unknown module: ${module}`);
  const command = spec.commands ? args.shift() : undefined;
  if (command === "--help" || args.includes("--help")) {
    console.log(
      `${module} ${spec.commands?.join("|") ?? ""}\n${[...spec.strings, ...spec.booleans].map((v) => `--${v}`).join(" ")}`,
    );
    return 0;
  }
  if (spec.commands && !spec.commands.includes(command ?? ""))
    throw new CoreError(`Unknown command: ${command}`);
  const options: Record<
    string,
    { type: "string" | "boolean"; multiple?: boolean }
  > = {};
  for (const key of spec.strings)
    options[key] =
      key === "source"
        ? { type: "string", multiple: true }
        : { type: "string" };
  for (const key of spec.booleans) options[key] = { type: "boolean" };
  const { values } = parseArgs({ args, options, strict: true });
  const get = (key: string, required = false): string | undefined => {
    const value = values[key];
    if (required && typeof value !== "string")
      throw new CoreError(`Missing --${key}`);
    return typeof value === "string" ? value : undefined;
  };
  const required = (key: string) => get(key, true) as string;
  const bool = (key: string) => values[key] === true;
  const sources = Array.isArray(values.source)
    ? (values.source as string[])
    : [];
  const file = get("file");
  let inferredRoot = file ? path.dirname(path.resolve(file)) : undefined;
  if (module === "closure-audit" && inferredRoot && !get("project-root")) {
    for (const extra of [get("manual-review"), get("output")].filter(
      (v): v is string => v !== undefined,
    )) {
      const absolute = path.resolve(extra);
      while (true) {
        const relative = path.relative(inferredRoot, absolute);
        if (
          relative !== ".." &&
          !relative.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relative)
        )
          break;
        const parent = path.dirname(inferredRoot);
        if (parent === inferredRoot)
          throw new CoreError("Inputs must share a filesystem root");
        inferredRoot = parent;
      }
    }
  }
  const root = get("project-root") ?? inferredRoot;
  if (!root) throw new CoreError("Missing --project-root");
  const fs = new LocalDirFS(root);
  let result: unknown;
  let exitCode = 0;
  switch (module) {
    case "migrate-v4-1-preview":
      result = await previewV41Directory(root);
      if (get("output"))
        await writeV41PreviewReport(root, required("output"), result);
      break;
    case "init-project":
      result = await initProject(fs, required("project-id"));
      break;
    case "resource-registry":
      if (command === "validate") {
        const { errors } = await registry.validateRegistry(fs);
        result = { valid: !errors.length, errors };
        exitCode = errors.length ? 1 : 0;
      } else if (command === "select") {
        const query: ObjectData = {};
        for (const key of [
          "project",
          "volume",
          "arc",
          "chapter",
          "scene_type",
          "pov",
        ])
          query[key] = get(key.replaceAll("_", "-")) ?? null;
        result = await registry.select(fs, query, bool("author-only"));
      } else if (command === "transition")
        result = await registry.transition(
          fs,
          required("resource-id"),
          required("status"),
          {
            approved: bool("approved-by-user"),
            ...(get("approval-event")
              ? { approvalEvent: get("approval-event") as string }
              : {}),
            ...(get("closure-audit")
              ? { closureAudit: get("closure-audit") as string }
              : {}),
            ...(get("trial-report")
              ? { trialReport: get("trial-report") as string }
              : {}),
          },
        );
      else
        result = await registry.refreshHash(
          fs,
          required("resource-id"),
          bool("approved-by-user"),
        );
      break;
    case "approval-record":
      result = await approval.createEvent(
        fs,
        required("event-id"),
        required("action"),
        required("target"),
        bool("confirmed-by-user"),
      );
      break;
    case "audit-ledger":
      result = await ledgers.appendAudit(
        fs,
        await readJson(fs, required("event-json")),
      );
      break;
    case "problem-ledger":
      result =
        command === "append"
          ? await ledgers.appendProblem(
              fs,
              await readJson(fs, required("entry-json")),
            )
          : await ledgers.problemSummary(fs);
      break;
    case "project-readiness": {
      const checked = await checks.projectReadiness(fs);
      result = checked;
      exitCode = checked.ready ? 0 : 1;
      break;
    }
    case "governance-check": {
      const checked = await checks.governanceCheck(fs);
      result = checked;
      exitCode = checked.valid ? 0 : 1;
      break;
    }
    case "closure-audit": {
      const checked = await checks.closureAudit(
        fs,
        await requireFile(fs, required("file")),
        required("resource-id"),
        required("resource-version"),
        await readJson(fs, required("manual-review")),
      );
      if (get("output"))
        await writeText(fs, required("output"), `${pyJson(checked)}\n`);
      result = checked;
      exitCode = checked.pass ? 0 : 1;
      break;
    }
    case "compile-author-packet":
      if (command === "compile") {
        const compiled = await packet.compilePacket(fs, required("manifest"));
        result = {
          status: "compiled",
          output: fs.displayPath(compiled.output),
          warnings: compiled.warnings,
        };
      } else {
        const checked = await packet.checkPacket(fs, required("packet"));
        result = checked;
        exitCode = checked.valid ? 0 : 1;
      }
      break;
    case "story-state": {
      const initOptions: state.InitStateOptions = {};
      for (const [flag, key] of [
        ["last-approved", "lastApproved"],
        ["rewrite-cutoff", "rewriteCutoff"],
        ["snapshot-root", "snapshotRoot"],
      ] as const) {
        const value = get(flag);
        if (value) initOptions[key] = value;
      }
      if (command === "init")
        result = await state.initState(
          fs,
          required("outline"),
          sources,
          initOptions,
        );
      else if (command === "check")
        result = await state.computeStatus(fs, await state.loadState(fs));
      else if (command === "register-projection")
        result = await state.registerProjection(
          fs,
          required("projection"),
          required("chapter"),
          await readJson(fs, required("scope-file")),
        );
      else if (command === "record-approved")
        result = await state.recordApproved(
          fs,
          required("prose"),
          required("version"),
          required("approval-event"),
        );
      else if (command === "promote-approved")
        result = await state.promoteApproved(
          fs,
          required("target"),
          bool("replace-existing"),
          get("expected-target-sha256"),
        );
      else if (command === "migrate-state") {
        if (bool("check") === bool("apply"))
          throw new CoreError("Choose exactly one of --check or --apply");
        result = await state.migrateState(fs, bool("apply"));
      } else {
        const reconcile: state.ReconcileOptions = {
          sources,
          clearRewriteSnapshot: bool("clear-rewrite-snapshot"),
        };
        for (const [flag, key] of [
          ["outline", "outline"],
          ["memory-preview", "memoryPreview"],
          ["memory-approval-event", "memoryApprovalEvent"],
          ["rewrite-cutoff", "rewriteCutoff"],
          ["snapshot-root", "snapshotRoot"],
        ] as const) {
          const value = get(flag);
          if (value) reconcile[key] = value;
        }
        result = await state.reconcileState(fs, reconcile);
      }
      break;
    }
    case "handoff-validator": {
      if (bool("creation-check") && bool("for-execution"))
        throw new CoreError("creation-check与for-execution不能同时使用", 1);
      const value = await readJson(fs, required("file"));
      let raw: string | undefined;
      if (bool("creation-check")) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin)
          chunks.push(Buffer.from(chunk));
        raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim())
          throw new CoreError(
            "creation-check必须从标准输入接收当前原始用户表达",
            1,
          );
      }
      const errors = bool("for-execution")
        ? await handoff.executeHandoff(fs, value)
        : await handoff.validateHandoff(
            value,
            raw === undefined ? {} : { rawSource: raw },
          );
      result = { valid: !errors.length, errors };
      exitCode = errors.length ? 1 : 0;
      break;
    }
  }
  console.log(pyJson(result));
  return exitCode;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR: ${(error as Error).message}`);
    const code = (error as NodeJS.ErrnoException).code;
    process.exitCode =
      error instanceof CoreError
        ? error.exitCode
        : typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")
          ? 2
          : 1;
  }
}

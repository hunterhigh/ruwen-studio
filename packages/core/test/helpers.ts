import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as approval from "../src/approval/index.ts";
import { CHECK_NAMES, closureAudit } from "../src/checks/index.ts";
import { LocalDirFS } from "../src/fs/local-dir-fs.ts";
import type { ProjectFS } from "../src/fs/project-fs.ts";
import { initProject } from "../src/init/index.ts";
import { compilePacket } from "../src/packet/index.ts";
import { REGISTRY, readRegistry } from "../src/registry/index.ts";
import {
  type ObjectData,
  pyJson,
  readJson,
  writeJson,
  writeText,
} from "../src/runtime.ts";
import { initState, registerProjection } from "../src/state/index.ts";
import ready from "./fixtures/ready-resources.json" with { type: "json" };

export const MANIFEST = "authoring-ruwen-v5/manifests/author-manifest.json";
export const PROJECTION = "authoring-ruwen-v5/projections/current.md";
export const CANDIDATE = "authoring-ruwen-v5/candidates/chapter-001.md";
export const FIELD =
  "冬日下午，主角在河谷驿站等一匹尚未卸鞍的马，旧伤使他不愿久站。院中粮车正被驿吏改挂另一座城的木牌，车夫催促装最后一袋。主角要把封信送过封冻前的山口，却不知道改道是否意味着前路已经封锁。他必须在驿吏放出下一匹马前决定是否继续；粮车会先离开。";
export const scope = (chapter = "001"): ObjectData => ({
  project: "test-project",
  volume: "v1",
  arc: "arc-1",
  chapter,
  scene_type: "travel",
  pov: "主角",
});
export function failWrite(base: ProjectFS, targetPath: string): ProjectFS {
  let fired = false;
  const wrap = (current: ProjectFS): ProjectFS =>
    new Proxy(current, {
      get(target, key) {
        if (key === "write")
          return async (p: string, data: string | Uint8Array) => {
            if (p === targetPath && !fired) {
              fired = true;
              throw new Error("simulated write failure");
            }
            return target.write(p, data);
          };
        if (key === "transaction")
          return <T>(fn: (tx: ProjectFS) => Promise<T>) =>
            target.transaction((tx) => fn(wrap(tx)));
        const member: unknown = Reflect.get(target, key);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
  return wrap(base);
}
export async function temporaryProject() {
  const parent = await mkdtemp(path.join(tmpdir(), "ruwen-core-"));
  const fs = new LocalDirFS(path.join(parent, "project"));
  await initProject(fs, "test-project");
  return {
    fs,
    parent,
    cleanup: () => rm(parent, { recursive: true, force: true }),
  };
}
export async function makeApproval(
  fs: ProjectFS,
  target: string,
  action: string,
  id: string,
): Promise<string> {
  const p = `治理/审批/${id}.json`;
  await writeText(
    fs,
    p,
    pyJson(
      {
        schema_version: "1.0",
        id,
        action,
        target_path: fs.path(target),
        target_sha256: await fs.sha256(target),
        approved_at: "2026-08-28T00:00:00Z",
        approved_by: "user",
        consumed: false,
      },
      false,
    ),
  );
  return p;
}
export async function updateResource(
  fs: ProjectFS,
  id: string,
  content: string,
  active = true,
): Promise<void> {
  await fs.transaction(async (tx) => {
    const registry = await readRegistry(tx);
    const item = registry.resources.find((r) => r.id === id);
    if (!item) throw new Error(`Unknown resource ${id}`);
    await writeText(tx, item.path, content);
    item.source_sha256 = await tx.sha256(item.path);
    if (active) {
      item.status = "active";
      item.approval = {
        status: "approved",
        approved_at: "2026-08-28T00:00:00Z",
        approved_by: "user",
      };
      const sequence =
        1 +
        (await approval.usageEntries(tx)).filter((e) =>
          String(e.event_id).startsWith(`${id}-activate-`),
        ).length;
      const eventPath = await makeApproval(
        tx,
        item.path,
        item.type === "expression"
          ? "expression_activate"
          : "resource_activate",
        `${id}-activate-${sequence}`,
      );
      await approval.consumeEvent(
        tx,
        await readJson(tx, eventPath),
        "xiangmu-zhiliyuan",
      );
      item.approval.approval_event_path = eventPath;
      item.approval.approval_event_sha256 = await tx.sha256(eventPath);
      if (item.type === "expression") {
        const prefix = `治理/激活证据/${id}`;
        const output = `${prefix}-trial.md`;
        const audit = `${prefix}-closure.json`;
        const trial = `${prefix}-trial.json`;
        await writeText(tx, output, "非正典隔离试写。");
        const manual = {
          resource_id: id,
          resource_path: tx.displayPath(item.path),
          resource_version: item.version,
          resource_sha256: item.source_sha256,
          reviewed_by: "user",
          checks: Object.fromEntries(CHECK_NAMES.map((k) => [k, "pass"])),
        };
        await writeText(
          tx,
          audit,
          pyJson(await closureAudit(tx, item.path, id, item.version, manual)),
        );
        await writeText(
          tx,
          trial,
          pyJson(
            {
              resource_id: id,
              resource_path: item.path,
              resource_version: item.version,
              resource_sha256: item.source_sha256,
              output_path: output,
              output_sha256: await tx.sha256(output),
              user_accepted: true,
              canonical: false,
            },
            false,
          ),
        );
        item.approval.closure_audit_path = audit;
        item.approval.closure_audit_sha256 = await tx.sha256(audit);
        item.approval.trial_report_path = trial;
        item.approval.trial_report_sha256 = await tx.sha256(trial);
      }
    }
    await writeJson(tx, REGISTRY, registry);
  });
}
export const makeReady = (fs: ProjectFS) =>
  fs.transaction(async (tx) => {
    for (const [id, content] of Object.entries(ready))
      await updateResource(tx, id, content);
  });
export async function preparePacket(fs: ProjectFS): Promise<string> {
  await makeReady(fs);
  await initState(fs, "故事/当前故事弧.md", [
    "character=人物/主角档案.md",
    "world=世界/世界总表.md",
    "situation=世界/当前态势.md",
  ]);
  await writeText(fs, PROJECTION, FIELD);
  await registerProjection(fs, PROJECTION, "001", scope());
  const manifest = await readJson(fs, MANIFEST);
  manifest.context_scope = scope();
  await writeJson(fs, MANIFEST, manifest);
  return (await compilePacket(fs, MANIFEST)).output;
}

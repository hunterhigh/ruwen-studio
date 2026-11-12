import {
  approval,
  checks,
  initProject,
  type ProjectFS,
  registry,
  state,
} from "../../packages/core/src/index.ts";
import { readJson, writeJson } from "../../packages/core/src/runtime.ts";
// Synthetic disposable fixture setup only. Pre-set approvals/evidence never approve live product data.
export async function buildSmokeProject(
  fs: ProjectFS,
  {
    contents,
    scope,
    projectionText,
    trialText: trialProse,
    lockedEvents = [],
  }: {
    contents: Record<string, string>;
    scope: {
      project: string;
      volume: string;
      arc: string;
      chapter: string;
      scene_type: string;
      pov: string;
    };
    projectionText: string;
    trialText: string;
    lockedEvents?: string[];
  },
) {
  const projectKey = scope.project;
  await initProject(fs, projectKey);
  await fs.transaction(async (tx) => {
    const data = await registry.readRegistry(tx);
    for (const [id, content] of Object.entries(contents)) {
      const resource = data.resources.find((r) => r.id === id);
      if (!resource) throw new Error(`Missing template resource ${id}`);
      if (id === "zhujue-pov-jingtou") resource.scope.povs = [scope.pov];
      await tx.write(resource.path, content);
      resource.source_sha256 = await tx.sha256(resource.path);
      const event = await approval.createEvent(
        tx,
        `demo-${id}`,
        resource.type === "expression"
          ? "expression_activate"
          : "resource_activate",
        resource.path,
        true,
      );
      const eventPath = String(event.event);
      await approval.consumeEvent(
        tx,
        await readJson(tx, eventPath),
        "xiangmu-zhiliyuan",
      );
      resource.status = "active";
      resource.approval = {
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: "user",
        approval_event_path: eventPath,
        approval_event_sha256: await tx.sha256(eventPath),
      };
      if (resource.type === "expression") {
        const prefix = `治理/激活证据/demo-${id}`;
        const trialText = `${prefix}-trial.md`,
          audit = `${prefix}-closure.json`,
          trial = `${prefix}-trial.json`;
        await tx.write(trialText, trialProse);
        const manual = {
          resource_id: id,
          resource_path: resource.path,
          resource_version: resource.version,
          resource_sha256: resource.source_sha256,
          reviewed_by: "user",
          checks: Object.fromEntries(
            checks.CHECK_NAMES.map((name) => [name, "pass"]),
          ),
        };
        // Fixture evidence must remain bound to the same logical path after copy.
        const portable = new Proxy(tx, {
          get(target, key) {
            if (key === "displayPath") return (p: string) => target.path(p);
            const member: unknown = Reflect.get(target, key);
            return typeof member === "function" ? member.bind(target) : member;
          },
        }) as ProjectFS;
        await writeJson(
          tx,
          audit,
          await checks.closureAudit(
            portable,
            resource.path,
            id,
            resource.version,
            manual,
          ),
        );
        await writeJson(tx, trial, {
          resource_id: id,
          resource_path: resource.path,
          resource_version: resource.version,
          resource_sha256: resource.source_sha256,
          output_path: trialText,
          output_sha256: await tx.sha256(trialText),
          user_accepted: true,
          canonical: false,
        });
        Object.assign(resource.approval, {
          closure_audit_path: audit,
          closure_audit_sha256: await tx.sha256(audit),
          trial_report_path: trial,
          trial_report_sha256: await tx.sha256(trial),
        });
      }
    }
    await writeJson(tx, registry.REGISTRY, data);
  });
  await state.initState(fs, "故事/当前故事弧.md", [
    "character=人物/主角档案.md",
    "world=世界/世界总表.md",
    "situation=世界/当前态势.md",
  ]);
  const projection = "authoring-ruwen-v5/projections/current.md";
  await fs.write(projection, projectionText);
  await state.registerProjection(fs, projection, "001", scope);
  const manifestPath = "authoring-ruwen-v5/manifests/author-manifest.json";
  const manifest = await readJson(fs, manifestPath);
  manifest.context_scope = scope;
  await writeJson(fs, manifestPath, manifest);
  await writeJson(fs, `${projection}.promises.json`, {
    projection_sha256: await fs.sha256(projection),
    locked_events: lockedEvents,
    locked_order: [],
  });
  await fs.write(
    "DEMO.md",
    "# 演示夹具\n\n本目录是P3合成演示资料，预置批准和手写非正典试写仅用于夹具初始化，不代表真实用户对生成正文的批准或文学效果验收。候选稿与记忆预览仍分别等待人工批准。请复制到新目录运行，避免把运行产物提交为演示源。\n",
  );
  const ready = await checks.projectReadiness(fs);
  if (!ready.ready) throw new Error(ready.errors.join("\n"));
  return {
    project: projectKey,
    root: fs.root,
    ready: ready.ready,
    files: (await fs.list()).length,
  };
}

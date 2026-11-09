import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { obj, str } from "@earendil-works/pi-schema";
import { candidateProblems, registry } from "@ruwen/core";
import { defaultUpstreamRoot } from "../prompts/manifest.ts";
import type { Data, RoleContext, RoleId, RoleTool } from "../types.ts";

export const DIAGNOSTICS = [
  "attention-and-structure",
  "dialogue-and-encounter",
  "explanation",
  "face-and-affect",
] as const;
const resourceReaders: RoleId[] = [
  "chuangyi-xietiaoyuan",
  "xiangmu-zhiliyuan",
  "waibu-zhishi-guwen",
  "biaoxian-shejishi",
  "gushi-gousishi",
  "zhangjie-qingjing-bianyiyuan",
  "jiyi-weihuyuan",
];
export async function listAuthorizedResources(ctx: RoleContext, role: RoleId) {
  const { data, errors } = await registry.validateRegistry(ctx.fs);
  if (errors.length) throw new Error("资源注册表无效，需要先处理治理检查");
  return data.resources.filter(
    (r) =>
      r.status === "active" &&
      r.approval.status === "approved" &&
      r.scope.project === ctx.projectKey &&
      r.readers.includes(role) &&
      (ctx.fs.path(r.path) !== "治理/文学问题账本.jsonl" ||
        role === "wenxue-bianji"),
  );
}
export async function readAuthorizedResource(
  ctx: RoleContext,
  role: RoleId,
  id: string,
): Promise<Data> {
  if (["xiaoshuo-zuozhe", "qinggan-duzhe"].includes(role))
    throw new Error("该岗位只接收固定输入，不直接读取项目资源");
  const resource = (await listAuthorizedResources(ctx, role)).find(
    (r) => r.id === id,
  );
  if (!resource) throw new Error("资源不存在或当前岗位无权读取");
  const bytes = await ctx.fs.read(resource.path);
  if (
    resource.source_sha256 !== createHash("sha256").update(bytes).digest("hex")
  )
    throw new Error("资源版本已变化");
  const result: Data = {
    id: resource.id,
    path: resource.path,
    sha256: resource.source_sha256,
    content: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(bytes)
      .replace(/\r\n?/g, "\n"),
  };
  ctx.onResourceRead?.(result, role);
  return result;
}
export async function authorizedResourceInputs(
  ctx: RoleContext,
  role: RoleId,
): Promise<Data[]> {
  const inputs: Data[] = [];
  for (const resource of await listAuthorizedResources(ctx, role))
    inputs.push(await readAuthorizedResource(ctx, role, resource.id));
  return inputs;
}
const result = (value: Data) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  details: value,
});
export function roleTools(id: RoleId, ctx: RoleContext): RoleTool[] {
  const tools: RoleTool[] = [];
  if (id === "xiangmu-zhiliyuan")
    tools.push({
      name: "read_problem_summary",
      label: "文学问题统计",
      description:
        "只读取类别、次数、任务数及复发候选标记，不返回正文定位、条件、处理、结果或任务标识；统计不能自动生成作者禁令。",
      parameters: obj({}),
      execute: async () =>
        result(
          (await candidateProblems.counts(
            ctx.fs,
            ctx.projectId ?? ctx.projectKey,
          )) as Data,
        ),
    });
  if (resourceReaders.includes(id)) {
    tools.push({
      name: "read_resource",
      label: "读取已授权资源",
      description: "按已登记资源ID读取当前项目中本岗位有权限的active资源。",
      parameters: obj({ id: str({ pattern: "^[a-z0-9-]{2,64}$" }) }),
      execute: async (_call, args) =>
        result(await readAuthorizedResource(ctx, id, String(args.id))),
    });
    tools.push({
      name: "list_resources",
      label: "列出已授权资源",
      description: "仅列出当前项目本岗位可读的active资源。",
      parameters: obj({}),
      execute: async () =>
        result({
          resources: (await listAuthorizedResources(ctx, id)).map((r) => ({
            id: r.id,
            type: r.type,
            scope: r.scope,
            version: r.version,
          })),
        }),
    });
  }
  if (id === "wenxue-bianji") {
    let calls = 0;
    tools.push({
      name: "load_diagnostic",
      label: "按需诊断",
      description: `选择一个已定位问题的诊断；每次运行最多2次：${DIAGNOSTICS.join(", ")}`,
      parameters: obj({ name: str({ minLength: 1, maxLength: 80 }) }),
      execute: async (_call, args) => {
        if (calls >= 2) throw new Error("每次运行最多读取两份诊断");
        const name = String(args.name);
        if (!(DIAGNOSTICS as readonly string[]).includes(name))
          throw new Error("未知诊断");
        calls++;
        const p = path.join(
          ctx.upstreamRoot ?? defaultUpstreamRoot,
          "01-完整插件/ruwen-xiezuo-xitong/skills/ruwen-zhangjie-xiezuo/references/diagnostics",
          `${name}.md`,
        );
        return result({
          name,
          content: (await readFile(p, "utf8")).replace(/\r\n?/g, "\n"),
        });
      },
    });
  }
  if (id === "waibu-zhishi-guwen" && ctx.search && ctx.searchApproved) {
    const search = ctx.search;
    let calls = 0;
    tools.push({
      name: "web_search",
      label: "批准后的外部调查",
      description: "只调查已批准学习计划内的问题；最多3次搜索。",
      parameters: obj({ query: str({ minLength: 1, maxLength: 500 }) }),
      execute: async (_call, args, signal) => {
        if (calls++ >= 3) throw new Error("本次调查已达到搜索次数上限");
        return result({
          results: await search.search(String(args.query), signal),
        });
      },
    });
  }
  return tools;
}

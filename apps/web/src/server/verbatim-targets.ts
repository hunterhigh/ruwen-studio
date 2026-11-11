import type { registry } from "@ruwen/core";
/** Presentation filter only; the service rechecks ownership, path, state, scope and hashes at create/approve. */
export function verbatimTargetOptions(
  resources: registry.Resource[],
  projectKey: string,
) {
  const prefixes: Record<string, string[]> = {
    governance: ["项目/", "治理/", "AGENTS.md"],
    character: ["人物/"],
    world: ["世界/"],
    story: ["故事/"],
    evidence: ["研究/"],
    validation: ["校验/"],
    expression: ["表现/"],
  };
  const reserved = [
    "治理/审批/",
    "治理/交接/",
    "治理/构思决定/",
    "治理/资源注册表.json",
    "治理/审计账本.jsonl",
    "治理/文学问题账本.jsonl",
    "authoring-ruwen-v5/",
    "chapters/",
  ];
  return resources
    .filter(
      (r) =>
        !["retired", "superseded"].includes(r.status) &&
        !(r.type === "expression" && r.status === "active") &&
        (r.scope.project === null || r.scope.project === projectKey) &&
        prefixes[r.type]?.some(
          (prefix) => r.path === prefix || r.path.startsWith(prefix),
        ) &&
        !reserved.some(
          (prefix) => r.path === prefix || r.path.startsWith(prefix),
        ),
    )
    .map((r) => ({ id: r.id, path: r.path }));
}

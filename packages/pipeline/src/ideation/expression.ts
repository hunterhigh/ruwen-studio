import { checks, type ProjectFS, registry } from "@ruwen/core";
import { previewBytesHash } from "./backend.ts";
import type { IdeationExpressionPreview, IdeationFileRef } from "./contract.ts";
import { ideationFail } from "./sessions.ts";

export const expressionCategories = {
  route: "route",
  fulfillment: "fulfillment",
  mapping: "closed_mapping",
  anchoring: "example_anchor",
  density: "semantic_density",
  proximity: "source_proximity",
} as const;
export const evidenceBytes = (value: unknown) =>
  `${JSON.stringify(value, null, 2)}\n`;
export const fileRef = (path: string, content: string): IdeationFileRef =>
  ({ path, sha256: previewBytesHash(content) }) as IdeationFileRef;

/** Read-only overlay runs the SAME core audit without prematurely writing a proposed file. */
export async function expressionAudit(
  fs: ProjectFS,
  preview: Omit<IdeationExpressionPreview, "status" | "sha256">,
) {
  const patch = preview.patches[0],
    metadata = preview.registryChanges[0]?.after;
  if (
    !patch ||
    patch.kind !== "create" ||
    !metadata ||
    patch.resourceId !== preview.resource.id ||
    metadata.id !== preview.resource.id
  )
    ideationFail("PREVIEW_STALE");
  const review = preview.closureAudit.checks;
  const valid =
    review.length === 6 &&
    new Set(review.map((v) => v.category)).size === 6 &&
    review.every(
      (v) =>
        Object.hasOwn(expressionCategories, v.category) &&
        v.resolved &&
        v.summary.trim() &&
        ["low", "medium", "high"].includes(v.risk),
    );
  const manual = valid
    ? {
        resource_id: metadata.id,
        resource_path: metadata.path,
        resource_version: metadata.version,
        resource_sha256: metadata.sha256,
        reviewed_by: "biaoxian-shejishi",
        checks: Object.fromEntries(
          review.map((v) => [expressionCategories[v.category], "pass"]),
        ),
      }
    : null;
  const overlay = new Proxy(fs, {
    get(target, key) {
      if (key === "readText")
        return async (path: string) =>
          target.path(path) === patch.path
            ? patch.content
            : target.readText(path);
      if (key === "sha256")
        return async (path: string) =>
          target.path(path) === patch.path
            ? previewBytesHash(patch.content)
            : target.sha256(path);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return checks.closureAudit(
    overlay,
    patch.path,
    metadata.id,
    metadata.version,
    manual,
  );
}

export async function requireCandidate(
  fs: ProjectFS,
  preview: IdeationExpressionPreview,
) {
  const validated = await registry.validateRegistry(fs);
  if (validated.errors.length) ideationFail("PRECONDITION_FAILED");
  const resource = validated.data.resources.find(
    (r) => r.id === preview.resource.id,
  );
  if (
    !resource ||
    resource.type !== "expression" ||
    resource.status !== "candidate" ||
    !resource.readers.includes("biaoxian-shejishi")
  )
    ideationFail("PRECONDITION_FAILED");
  if (
    resource.path !== preview.resource.path ||
    resource.source_sha256 !== preview.resource.sha256 ||
    (await fs.sha256(resource.path)) !== resource.source_sha256
  )
    ideationFail("RESOURCE_STALE");
  const audit = preview.closureAudit.report;
  if (
    !audit ||
    (await fs.sha256(audit.path)) !== audit.sha256 ||
    resource.approval.closure_audit_sha256 !== audit.sha256 ||
    (await registry.validateClosureEvidence(fs, resource, resource.approval))
      .length
  )
    ideationFail("CLOSURE_AUDIT_REQUIRED");
  return resource;
}

export function trialEvidence(
  resource: registry.Resource,
  trialId: string,
  sample: string,
) {
  const samplePath = `authoring-ruwen-v5/reports/ideation/trials/${trialId}.md`,
    reportPath = `authoring-ruwen-v5/reports/ideation/trials/${trialId}.json`;
  const bytes = evidenceBytes({
    resource_id: resource.id,
    resource_path: resource.path,
    resource_version: resource.version,
    resource_sha256: resource.source_sha256,
    output_path: samplePath,
    output_sha256: previewBytesHash(sample),
    user_accepted: true,
    canonical: false,
  });
  return { samplePath, reportPath, bytes, report: fileRef(reportPath, bytes) };
}

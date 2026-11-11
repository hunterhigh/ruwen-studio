import { registry } from "@ruwen/core";
import { securityLimits } from "../../../../../../../../config/security.ts";
import { IdeationStudio } from "../../../../../components/IdeationStudio.tsx";
import { ownedPage } from "../../../../../server/page-auth.ts";
export default async function IdeationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const owned = await ownedPage({ projectId });
  const metadata = await registry.readRegistry(owned.fs);
  let scope: Record<string, unknown> = {};
  if (
    await owned.fs.exists("authoring-ruwen-v5/manifests/author-manifest.json")
  ) {
    const manifest = JSON.parse(
      await owned.fs.readText(
        "authoring-ruwen-v5/manifests/author-manifest.json",
      ),
    );
    if (manifest.context_scope && typeof manifest.context_scope === "object")
      scope = manifest.context_scope;
  }
  const field = (key: string) =>
    typeof scope[key] === "string" ? String(scope[key]) : null;
  return (
    <IdeationStudio
      key={projectId}
      projectId={projectId}
      modelMode={owned.services.worker.modelMode}
      compileScope={{
        volume: field("volume"),
        arc: field("arc"),
        scene_type: field("scene_type"),
        pov: field("pov"),
      }}
      compileSources={metadata.resources
        .filter(
          (r) =>
            r.status === "active" &&
            ["world", "character", "story"].includes(r.type) &&
            r.approval.status === "approved" &&
            r.readers.includes("zhangjie-qingjing-bianyiyuan"),
        )
        .map((r) => ({ id: r.id, path: r.path, sha256: r.source_sha256 }))}
      chatLimit={securityLimits().chatChars}
    />
  );
}

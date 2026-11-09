import { ProjectHome } from "../../../../components/ProjectHome.tsx";
import { ownedPage } from "../../../../server/page-auth.ts";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await ownedPage({ projectId });
  return <ProjectHome id={projectId} />;
}

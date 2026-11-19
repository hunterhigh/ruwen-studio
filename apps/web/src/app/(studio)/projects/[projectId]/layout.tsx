import type { ReactNode } from "react";
import { ProjectBar } from "../../../../components/ProjectBar.tsx";
import { ProjectDecisionsProvider } from "../../../../components/project/ProjectDecisions.tsx";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <ProjectDecisionsProvider key={projectId} id={projectId}>
      <ProjectBar id={projectId} />
      {children}
    </ProjectDecisionsProvider>
  );
}

import type { ReactNode } from "react";
import { ProjectBar } from "../../../../components/ProjectBar.tsx";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return (
    <>
      <ProjectBar id={projectId} />
      {children}
    </>
  );
}

import { ChapterStudio } from "../../../../../components/ChapterStudio.tsx";
import { ownedPage } from "../../../../../server/page-auth.ts";
export default async function ChaptersPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ run?: string; view?: string }>;
}) {
  const { projectId } = await params;
  const { run, view } = await searchParams;
  await ownedPage({ projectId });
  if (run) {
    const owned = await ownedPage({ runId: run });
    if (owned.project.id !== projectId) {
      const { notFound } = await import("next/navigation.js");
      notFound();
    }
  }
  return (
    <ChapterStudio
      projectId={projectId}
      memoryView={view === "memory"}
      {...(run ? { initialRun: run } : {})}
    />
  );
}

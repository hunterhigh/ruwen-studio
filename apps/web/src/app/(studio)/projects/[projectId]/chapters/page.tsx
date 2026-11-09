import { ChapterStudio } from "../../../../../components/ChapterStudio.tsx";
import { ownedPage } from "../../../../../server/page-auth.ts";
export default async function ChaptersPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { projectId } = await params;
  const { run } = await searchParams;
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
      {...(run ? { initialRun: run } : {})}
    />
  );
}

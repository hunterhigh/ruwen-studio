import { Files } from "../../../../../components/Files.tsx";
import { ownedPage } from "../../../../../server/page-auth.ts";
export default async function FilesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await ownedPage({ projectId });
  return <Files id={projectId} />;
}

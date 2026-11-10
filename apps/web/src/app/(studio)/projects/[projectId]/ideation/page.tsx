import { securityLimits } from "../../../../../../../../config/security.ts";
import { runtimeSettings } from "../../../../../../../../config/settings.ts";
import { IdeationStudio } from "../../../../../components/IdeationStudio.tsx";
import { ownedPage } from "../../../../../server/page-auth.ts";
export default async function IdeationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await ownedPage({ projectId });
  return (
    <IdeationStudio
      key={projectId}
      projectId={projectId}
      demoTiming={runtimeSettings().ideationDemo}
      chatLimit={securityLimits().chatChars}
    />
  );
}

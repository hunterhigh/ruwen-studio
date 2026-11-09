import { ProjectNav } from "../../../../../components/ProjectHome.tsx";
import { ownedPage } from "../../../../../server/page-auth.ts";
export default async function IdeationPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await ownedPage({ projectId });
  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">故事构思</span>
          <h1>从想写的那一刻开始。</h1>
        </div>
      </header>
      <ProjectNav id={projectId} current="/ideation" />
      <div className="empty-state">
        <h2>构思工作台正在接入</h2>
        <p>
          本页等待构思服务契约完成后开放。现在可用演示项目体验章节写作与两次批准流程。
        </p>
        <a className="button primary" href={`/projects/${projectId}/chapters`}>
          前往章节工作台 →
        </a>
      </div>
    </main>
  );
}

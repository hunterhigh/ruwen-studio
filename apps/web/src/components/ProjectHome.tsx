"use client";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";
export function ProjectNav({ id, current }: { id: string; current: string }) {
  return (
    <nav className="project-nav" aria-label="项目导航">
      {[
        ["", "项目概览"],
        ["/ideation", "故事构思"],
        ["/chapters", "章节写作"],
        ["/files", "项目资料"],
      ].map(([suffix, label]) => (
        <a
          key={suffix}
          aria-current={current === suffix ? "page" : undefined}
          href={`/projects/${id}${suffix}`}
        >
          {label}
        </a>
      ))}
      <a className="export-link" href={`/api/projects/${id}/export`}>
        导出 ZIP ↓
      </a>
    </nav>
  );
}
export function ProjectHome({ id }: { id: string }) {
  const { data, error } = useApi<{
    project: { title: string };
    readiness: { ready: boolean; errors: string[] };
    state: unknown;
  }>(`/api/projects/${id}`);
  const runs = useApi<{ id: string; chapter: string; status: string }[]>(
    `/api/projects/${id}/runs`,
  );
  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">项目 / OVERVIEW</span>
          <h1>
            <SafeMarkdown
              plain
              inline
              content={data?.project.title ?? "正在打开项目…"}
            />
          </h1>
          <p>资料先于正文，确认先于正典。</p>
        </div>
        <a className="button primary" href={`/projects/${id}/chapters`}>
          进入章节写作 →
        </a>
      </header>
      <ProjectNav id={id} current="" />
      {error && (
        <div role="alert" className="error">
          <SafeMarkdown plain content={error} />
        </div>
      )}
      <div className="overview-grid">
        <section className="paper-panel">
          <span className="eyebrow">写作前的准备</span>
          <h2>
            {data?.readiness.ready ? "项目资料已就绪" : "还有资料需要完成"}
          </h2>
          <p>就绪检查确认资料结构和批准状态，不评价文学质量。</p>
          {data?.readiness.errors.length === 0 ? (
            <p className="success-text">
              ✓ 必需文件、资源状态与项目资料检查通过。
            </p>
          ) : (
            <ul className="readiness-list">
              {data?.readiness.errors.map((item) => (
                <li key={item}>
                  <SafeMarkdown plain inline content={item} />
                </li>
              ))}
            </ul>
          )}
          <a className="text-link" href={`/projects/${id}/files`}>
            查看项目资料 ↗
          </a>
        </section>
        <section className="paper-panel">
          <span className="eyebrow">最近的工作</span>
          <h2>章节与待确认稿件</h2>
          {runs.data?.length === 0 && (
            <p>还没有章节运行。备好章节情境后，即可发起第一章。</p>
          )}
          <ul className="run-list">
            {runs.data?.map((run) => (
              <li key={run.id}>
                <a href={`/projects/${id}/chapters?run=${run.id}`}>
                  <strong>
                    第 <SafeMarkdown plain inline content={run.chapter} /> 章
                  </strong>
                  <span>
                    <SafeMarkdown plain inline content={run.status} />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

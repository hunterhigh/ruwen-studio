"use client";
import { type FormEvent, useState } from "react";
import { post, request } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

interface Project {
  id: string;
  title: string;
  pending: number;
  created_at: string;
}
export function Projects() {
  const { data, error: loadError } = useApi<Project[]>("/api/projects"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = new FormData(event.currentTarget);
    try {
      const result = await post<{ id: string }>("/api/projects", {
        title: values.get("title"),
        mode: values.get("mode"),
      });
      window.location.assign(`/projects/${result.id}`);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>(
        `/api/projects/import?title=${encodeURIComponent(file.name.replace(/\.zip$/i, ""))}`,
        {
          method: "POST",
          body: file,
          headers: { "content-type": "application/zip" },
        },
      );
      window.location.assign(`/projects/${result.id}`);
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">书架 / PROJECTS</span>
          <h1>让下一章，有处落笔。</h1>
          <p>从构思到正文，每份资料与每次确认都留在项目里。</p>
        </div>
        <button
          type="button"
          className="button primary"
          disabled={!data}
          onClick={() => setForm(!form)}
        >
          ＋ 新建项目
        </button>
      </header>
      {(error || loadError) && (
        <div role="alert" className="error">
          <SafeMarkdown plain content={error || loadError} />
        </div>
      )}
      {form && (
        <form className="creation-form" onSubmit={create}>
          <h2>开启一个故事</h2>
          <label>
            项目名称
            <input
              name="title"
              required
              maxLength={100}
              placeholder="例如：北岸冬信"
            />
          </label>
          <label>
            从哪里开始
            <select name="mode">
              <option value="blank">空白项目 · 先完成构思资料</option>
              <option value="demo">演示项目 · 已备好第一章资料</option>
            </select>
          </label>
          <button className="button primary" type="submit" disabled={busy}>
            创建项目
          </button>
          <button
            className="text-button"
            type="button"
            onClick={() => setForm(false)}
          >
            收起
          </button>
        </form>
      )}
      <section className="project-list" aria-label="项目书架">
        {!data && !loadError && <p>正在打开书架…</p>}
        {data?.map((project) => (
          <a
            className="project-row"
            href={`/projects/${project.id}`}
            key={project.id}
          >
            <div className="book-spine" aria-hidden="true">
              如文
            </div>
            <div>
              <span className="eyebrow">写作项目</span>
              <h2>
                <SafeMarkdown plain inline content={project.title} />
              </h2>
              <p>
                创建于{" "}
                {new Date(project.created_at).toLocaleDateString("zh-CN")}
              </p>
            </div>
            <div className="project-row-end">
              {project.pending > 0 && (
                <span className="status-pill">
                  {project.pending} 份等待确认
                </span>
              )}
              <span aria-hidden="true">进入项目 ↗</span>
            </div>
          </a>
        ))}
        {data?.length === 0 && (
          <div className="empty-state">
            <span className="empty-mark">卷</span>
            <h2>书架还空着</h2>
            <p>新建空白项目开始构思，或创建演示项目体验章节流程。</p>
            <button
              type="button"
              className="button primary"
              onClick={() => setForm(true)}
            >
              新建第一个项目
            </button>
          </div>
        )}
      </section>
      <footer className="shelf-footer">
        <div>
          <h3>已有如文项目？</h3>
          <p>导入保留原目录的 ZIP，也可在项目内完整导出。</p>
        </div>
        <label className="button secondary upload-label">
          导入项目 ZIP
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={busy || !data}
            onChange={(event) => {
              void upload(event.target.files?.[0]);
            }}
          />
        </label>
      </footer>
    </main>
  );
}

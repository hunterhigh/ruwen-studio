"use client";
import { useState } from "react";
import { request } from "./client.ts";
import { ProjectNav } from "./ProjectHome.tsx";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";
export function Files({ id }: { id: string }) {
  const { data, error: loadError } = useApi<{ paths: string[] }>(
      `/api/projects/${id}/files`,
    ),
    [file, setFile] = useState<{
      path: string;
      text: string;
      sha256: string;
    }>(),
    [error, setError] = useState(""),
    [raw, setRaw] = useState(false);
  const registryFile = useApi<{ text: string }>(
    `/api/projects/${id}/files?path=${encodeURIComponent("治理/资源注册表.json")}`,
  );
  let resources: Record<string, unknown>[] = [];
  try {
    const parsed = JSON.parse(registryFile.data?.text ?? "{}");
    resources = parsed.resources ?? [];
  } catch {
    /* file errors remain visible */
  }
  const registered = resources.find((resource) => resource.path === file?.path);
  async function open(p: string) {
    try {
      setFile(
        await request(
          `/api/projects/${id}/files?path=${encodeURIComponent(p)}`,
        ),
      );
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  }
  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">项目资料 / FILES</span>
          <h1>故事留下的每一页。</h1>
          <p>只读浏览。资料变更通过预览与批准提交。</p>
        </div>
      </header>
      <ProjectNav id={id} current="/files" />
      {(error || loadError) && (
        <div role="alert" className="error">
          <SafeMarkdown plain content={error || loadError} />
        </div>
      )}
      <div className="file-browser">
        <nav className="file-tree" aria-label="项目文件">
          {data?.paths.map((p) => (
            <button
              key={p}
              className={p === file?.path ? "selected" : ""}
              type="button"
              onClick={() => {
                void open(p);
              }}
            >
              <SafeMarkdown plain inline content={p} />
            </button>
          ))}
        </nav>
        <article className="file-content">
          {file ? (
            <>
              <header>
                <h2>
                  <SafeMarkdown plain inline content={file.path} />
                </h2>
                <label className="confirm-check">
                  <input
                    type="checkbox"
                    checked={raw}
                    onChange={(event) => setRaw(event.target.checked)}
                  />
                  查看原文
                </label>
              </header>
              <div className="file-metadata">
                <span>
                  SHA256 <SafeMarkdown plain inline content={file.sha256} />
                </span>
                {registered && (
                  <SafeMarkdown
                    plain
                    content={JSON.stringify(
                      {
                        status: registered.status,
                        scope: registered.scope,
                        readers: registered.readers,
                      },
                      null,
                      2,
                    )}
                  />
                )}
              </div>
              <SafeMarkdown
                plain={raw || !file.path.endsWith(".md")}
                content={file.text}
              />
            </>
          ) : (
            <div className="empty-state">
              <h2>选择一份资料</h2>
              <p>左侧保留原项目目录，内容不会因为浏览而改变。</p>
            </div>
          )}
        </article>
      </div>
    </main>
  );
}

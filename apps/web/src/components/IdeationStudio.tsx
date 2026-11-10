"use client";
import { useEffect, useState } from "react";
import { createIdeationDemo } from "./ideation/demo.ts";
import { ProjectNav } from "./ProjectHome.tsx";
import {
  applyRoleFrame,
  emptyRoleStreams,
  roleStreamText,
} from "./role-streams.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";

export function IdeationStudio({ projectId }: { projectId: string }) {
  const [adapter] = useState(() => createIdeationDemo(projectId));
  const [selected, setSelected] = useState(adapter.sessions[0]?.id ?? "");
  const [streams, setStreams] = useState(emptyRoleStreams);
  useEffect(() => {
    const unsubscribe = adapter.subscribe((event) => {
      if (
        event.projectId !== projectId ||
        !event.runId ||
        (event.type !== "delta" && event.type !== "reset")
      )
        return;
      setStreams((old) =>
        applyRoleFrame(old, { ...event, runId: event.runId ?? "" }),
      );
    });
    return () => {
      unsubscribe();
      adapter.dispose();
    };
  }, [adapter, projectId]);
  return (
    <main className="page-content">
      <header className="page-heading">
        <div>
          <span className="eyebrow">故事构思 / IDEATION</span>
          <h1>把想法，交还给故事。</h1>
        </div>
      </header>
      <ProjectNav id={projectId} current="/ideation" />
      <p className="notice">
        构思界面演示 · 使用本地假数据，不保存对话、不提交项目资料。刷新后重置。
      </p>
      <label>
        构思会话
        <select
          aria-label="构思会话"
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {adapter.sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title}
            </option>
          ))}
        </select>
      </label>
      <section aria-label="构思流式预览">
        <h2>创意协调员</h2>
        {adapter.runs
          .filter((run) => run.sessionId === selected)
          .map((run) => (
            <article
              key={run.runId}
              data-testid="ideation-stream"
              aria-label="当前岗位尝试"
            >
              <SafeMarkdown
                content={roleStreamText(
                  streams,
                  run.sessionId,
                  run.runId,
                  "chuangyi-xietiaoyuan",
                )}
              />
            </article>
          ))}
      </section>
      <details>
        <summary>流式演示场景</summary>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            const session = adapter.sessions.find((row) => row.id === selected);
            if (session) adapter.attempt(session.id, false);
          }}
        >
          演示格式更正
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            const session = adapter.sessions.find((row) => row.id === selected);
            if (session) adapter.attempt(session.id, true);
          }}
        >
          演示安全拒绝
        </button>
      </details>
    </main>
  );
}

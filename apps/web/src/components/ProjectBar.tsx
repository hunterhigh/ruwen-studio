"use client";
import { usePathname } from "next/navigation.js";
import { frameCopy } from "../copy/zh-CN.ts";
import { useProjectDecisions } from "./project/useProjectDecisions.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";

export function ProjectBar({ id }: { id: string }) {
  const pathname = usePathname();
  const { project, count, loading } = useProjectDecisions(id);
  const root = `/projects/${encodeURIComponent(id)}`;
  const modes = [
    ["", frameCopy.overview],
    ["/ideation", frameCopy.ideation],
    ["/chapters", frameCopy.chapters],
    ["/files", frameCopy.files],
  ];
  return (
    <header className="project-bar" aria-busy={loading}>
      <span className="project-bar-title">
        <SafeMarkdown
          plain
          inline
          content={project?.title ?? frameCopy.project}
        />
      </span>
      <nav className="project-modes" aria-label={frameCopy.projectNavigation}>
        {modes.map(([suffix, label]) => (
          <a
            key={suffix}
            href={root + suffix}
            aria-current={
              suffix
                ? pathname.startsWith(root + suffix)
                  ? "page"
                  : undefined
                : pathname === root
                  ? "page"
                  : undefined
            }
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="project-bar-right">
        {count > 0 && (
          <a className="decision-chip" href={`${root}#decisions`}>
            <span className="badge-count">{count}</span>
            {frameCopy.decisions}
          </a>
        )}
        <a
          className="quiet-link"
          href={`/api/projects/${encodeURIComponent(id)}/export`}
        >
          {frameCopy.exportZip}
        </a>
      </div>
    </header>
  );
}

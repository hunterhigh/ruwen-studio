"use client";
import { usePathname } from "next/navigation.js";
import { useState } from "react";
import { frameCopy, statusCopy } from "../copy/zh-CN.ts";
import { InlineNotice } from "../ui/InlineNotice.tsx";
import { useProjectDecisionContext } from "./project/ProjectDecisions.tsx";
import { SafeMarkdown } from "./SafeMarkdown.tsx";

export function ProjectBar({ id }: { id: string }) {
  const pathname = usePathname();
  const { project, count, loading } = useProjectDecisionContext();
  const root = `/projects/${encodeURIComponent(id)}`;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const modes = [
    ["", frameCopy.overview],
    ["/ideation", frameCopy.ideation],
    ["/chapters", frameCopy.chapters],
    ["/files", frameCopy.files],
  ];
  async function exportZip() {
    if (exporting) return;
    setExporting(true);
    setExportError(false);
    try {
      const response = await fetch(`/api${root}/export`, { cache: "no-store" });
      if (!response.ok) {
        setExportError(true);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `ruwen-${id}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setExportError(true);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
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
          <button
            className="quiet-link ui-export-zip"
            type="button"
            disabled={exporting}
            onClick={() => void exportZip()}
          >
            {frameCopy.exportZip}
          </button>
        </div>
      </header>
      {exportError && (
        <div className="ui-project-export-notice">
          <InlineNotice
            message={statusCopy.exportFailed}
            onAction={() => void exportZip()}
          />
        </div>
      )}
    </>
  );
}

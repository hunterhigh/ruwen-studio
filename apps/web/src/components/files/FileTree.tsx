import { useState } from "react";
import { filesCopy as copy } from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import {
  fileName,
  type ResourceEntry,
  statusLabel,
  statusTone,
  systemFolders,
} from "./file-data.ts";

const folders = [
  "项目",
  "人物",
  "世界",
  "故事",
  "表现",
  "研究",
  "校验",
  "治理",
  "chapters",
  "authoring-ruwen-v5",
];

export function FileTree({
  paths,
  loadError,
  registry,
  selected,
  onSelect,
}: {
  paths: string[] | undefined;
  loadError: string;
  registry: Map<string, ResourceEntry> | undefined;
  selected: string | undefined;
  onSelect: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [disclosed, setDisclosed] = useState<Record<string, boolean>>({});
  const search = query.trim().toLowerCase();
  const groups = new Map<string, string[]>();
  const loose = [];
  for (const path of paths ?? []) {
    if (!path.toLowerCase().includes(search)) continue;
    const slash = path.indexOf("/");
    if (slash < 0) {
      loose.push(path);
    } else {
      const group = path.slice(0, slash);
      const paths = groups.get(group);
      if (paths) paths.push(path);
      else groups.set(group, [path]);
    }
  }
  const order = [
    ...folders,
    ...[...groups.keys()].filter((group) => !folders.includes(group)),
  ];

  function fileRow(path: string) {
    const entry = registry?.get(path);
    return (
      <li key={path}>
        <button
          type="button"
          className={selected === path ? "selected" : undefined}
          aria-current={selected === path ? "true" : undefined}
          aria-label={path}
          aria-description={entry ? statusLabel(entry.status) : undefined}
          onClick={() => onSelect(path)}
        >
          <span className="files-tree-name">
            <SafeMarkdown plain inline content={fileName(path)} />
          </span>
          {entry && (
            <span
              aria-hidden="true"
              className={`files-dot files-tone-${statusTone(entry.status)}`}
            />
          )}
        </button>
      </li>
    );
  }

  return (
    <nav className="file-tree files-index" aria-label={copy.tree}>
      <div className="files-filter">
        <input
          type="search"
          aria-label={copy.search}
          placeholder={copy.search}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </div>
      {loadError ? (
        <p className="files-index-message" role="alert">
          <SafeMarkdown plain inline content={loadError} />
        </p>
      ) : (
        !paths && <p className="files-index-message">{copy.loadingPaths}</p>
      )}
      {paths && !groups.size && !loose.length && (
        <p className="files-index-message">
          {search ? copy.noMatches : copy.noFiles}
        </p>
      )}
      {order.map((folder, index) => {
        const rows = groups.get(folder);
        if (!rows) return null;
        const key = `${search ? "search" : "browse"}:${folder}`;
        const open = disclosed[key] ?? (Boolean(search) || index < 4);
        return (
          <div className="files-group" key={folder}>
            <button
              className="files-folder"
              type="button"
              aria-expanded={open}
              onClick={() => setDisclosed({ ...disclosed, [key]: !open })}
            >
              <span className="files-disclosure" aria-hidden="true" />
              <span>
                <SafeMarkdown plain inline content={`${folder}/`} />
              </span>
              {systemFolders.has(folder) && <small>{copy.system}</small>}
            </button>
            {open && <ul>{rows.map(fileRow)}</ul>}
          </div>
        );
      })}
      {loose.length > 0 && <ul className="files-root">{loose.map(fileRow)}</ul>}
    </nav>
  );
}

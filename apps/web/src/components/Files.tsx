"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { filesCopy as copy } from "../copy/zh-CN.ts";
import { request } from "./client.ts";
import {
  FileDocument,
  ResourceReaders,
  ResourceStatus,
} from "./files/FileDocument.tsx";
import { FileTree } from "./files/FileTree.tsx";
import {
  fileName,
  fileUrl,
  type ProjectFile,
  parseRegistry,
  type ResourceEntry,
  registryPath,
  stringList,
} from "./files/file-data.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

type Selection =
  | { path: string; status: "loading" }
  | { path: string; status: "loaded"; file: ProjectFile }
  | { path: string; status: "failed"; message: string };

function FileHeader({
  file,
  resource,
  metadataMessage,
}: {
  file: ProjectFile;
  resource: ResourceEntry | undefined;
  metadataMessage: string;
}) {
  return (
    <header className="files-document-header">
      <div className="files-document-title">
        <h2>
          <SafeMarkdown plain inline content={fileName(file.path)} />
        </h2>
        {resource && <ResourceStatus status={resource.status} />}
      </div>
      <p className="files-document-path">
        <SafeMarkdown plain inline content={file.path} />
      </p>
      {resource ? (
        <>
          <div className="files-scope">
            {Object.entries(copy.scope).map(([key, label]) => {
              const values = stringList(resource.scope?.[key]);
              if (!values?.length) return null;
              return (
                <span key={key} className="files-scope-tag">
                  {label}
                  <SafeMarkdown
                    plain
                    inline
                    content={values.join(copy.scopeSeparator)}
                  />
                </span>
              );
            })}
          </div>
          <div className="files-access">
            <span>{copy.readers}</span>
            <ResourceReaders readers={resource.readers} />
          </div>
        </>
      ) : (
        metadataMessage && <p className="files-muted">{metadataMessage}</p>
      )}
    </header>
  );
}

function ProjectFiles({ id }: { id: string }) {
  const base = `/api/projects/${id}/files`;
  const { data, error: loadError } = useApi<{ paths: string[] }>(base);
  const registryFile = useApi<ProjectFile>(fileUrl(base, registryPath));
  const [selection, setSelection] = useState<Selection>();
  const pending = useRef<AbortController>(null);
  const reader = useRef<HTMLElement>(null);
  const file = selection?.status === "loaded" ? selection.file : undefined;
  const registryText =
    file?.path === registryPath ? file.text : registryFile.data?.text;
  const registry = useMemo(() => parseRegistry(registryText), [registryText]);
  const metadataMessage = registry
    ? copy.unregistered
    : registryText !== undefined || registryFile.error
      ? copy.registryUnavailable
      : "";

  useEffect(() => () => pending.current?.abort(), []);

  async function open(path: string) {
    pending.current?.abort();
    reader.current?.scrollTo(0, 0);
    const controller = new AbortController();
    pending.current = controller;
    setSelection({ path, status: "loading" });
    try {
      const received =
        path === registryPath && registryFile.data
          ? registryFile.data
          : await request<ProjectFile>(fileUrl(base, path), {
              signal: controller.signal,
            });
      if (!controller.signal.aborted)
        setSelection({ path, status: "loaded", file: received });
    } catch (error) {
      if (!controller.signal.aborted) {
        setSelection({
          path,
          status: "failed",
          message: error instanceof Error ? error.message : copy.loadFileError,
        });
      }
    }
  }

  return (
    <main className="page-content files-page">
      <header className="page-heading files-heading">
        <div>
          <h1>{copy.heading}</h1>
          <p>{copy.readOnly}</p>
        </div>
      </header>
      <div className="file-browser files-browser">
        <FileTree
          paths={data?.paths}
          loadError={loadError}
          registry={registry}
          selected={selection?.path}
          onSelect={(path) => void open(path)}
        />
        <article
          ref={reader}
          className="file-content files-reader"
          aria-label={copy.reader}
          aria-busy={selection?.status === "loading"}
        >
          {!selection && <p className="files-empty">{copy.emptySelection}</p>}
          {selection?.status === "loading" && (
            <output>{copy.loadingFile}</output>
          )}
          {selection?.status === "failed" && (
            <p role="alert">
              <SafeMarkdown plain inline content={selection.message} />
            </p>
          )}
          {file && (
            <div className="files-document" key={file.path}>
              <FileHeader
                file={file}
                resource={registry?.get(file.path)}
                metadataMessage={metadataMessage}
              />
              <FileDocument file={file} registry={registry} />
              <details className="files-technical">
                <summary>{copy.technical}</summary>
                <dl>
                  <dt>{copy.sha256}</dt>
                  <dd>
                    <code>
                      <SafeMarkdown plain inline content={file.sha256} />
                    </code>
                  </dd>
                </dl>
              </details>
            </div>
          )}
        </article>
      </div>
    </main>
  );
}

export function Files({ id }: { id: string }) {
  return <ProjectFiles key={id} id={id} />;
}

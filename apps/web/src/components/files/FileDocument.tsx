import { useState } from "react";
import { cleanupCopy, filesCopy as copy } from "../../copy/zh-CN.ts";
import { KeyValueList } from "../../ui/KeyValueList.tsx";
import { RoleTag } from "../../ui/Role.tsx";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import {
  fileKeyValues,
  fileName,
  ledgerSummary,
  type ProjectFile,
  parseJson,
  parseLedger,
  type ResourceEntry,
  registryPath,
  statusLabel,
  statusTone,
} from "./file-data.ts";

export function ResourceStatus({ status }: { status: string }) {
  return (
    <span className={`files-badge files-tone-${statusTone(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

export function ResourceReaders({
  readers,
}: {
  readers: string[] | undefined;
}) {
  if (!readers?.length)
    return (
      <span className="files-muted">
        {readers ? copy.noReaders : copy.unknownReaders}
      </span>
    );
  return (
    <span className="files-readers">
      {[...new Set(readers)].map((role) => (
        <RoleTag key={role} role={role} />
      ))}
    </span>
  );
}

function RegistryTable({
  registry,
}: {
  registry: Map<string, ResourceEntry> | undefined;
}) {
  if (!registry) return <p>{copy.registryUnavailable}</p>;
  if (!registry.size) return <p>{copy.registryEmpty}</p>;
  return (
    <table className="files-registry" aria-label={copy.registryTable}>
      <thead>
        <tr>
          <th scope="col">{copy.resource}</th>
          <th scope="col">{copy.path}</th>
          <th scope="col">{copy.resourceStatus}</th>
          <th scope="col">{copy.readers}</th>
        </tr>
      </thead>
      <tbody>
        {[...registry.values()].map((entry) => (
          <tr key={entry.path}>
            <th scope="row">
              <SafeMarkdown
                plain
                inline
                content={entry.title ?? fileName(entry.path)}
              />
              <details className="files-registry-technical">
                <summary>{copy.technical}</summary>
                {cleanupCopy.resourceId}{" "}
                <code>
                  <SafeMarkdown plain inline content={entry.id} />
                </code>
              </details>
            </th>
            <td>
              <SafeMarkdown plain inline content={entry.path} />
            </td>
            <td>
              <ResourceStatus status={entry.status} />
            </td>
            <td>
              <ResourceReaders readers={entry.readers} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FileValues({ value }: { value: unknown }) {
  return (
    <div className="files-key-values">
      <KeyValueList value={fileKeyValues(value)} />
    </div>
  );
}

function LedgerItem({
  entry,
  timestamp,
}: {
  entry: Record<string, unknown>;
  timestamp: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const datetime =
    timestamp === undefined ? undefined : new Date(timestamp).toISOString();
  return (
    <li>
      <details onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>
          <span className="files-disclosure" aria-hidden="true" />
          <span className="files-ledger-label">
            <SafeMarkdown plain inline content={ledgerSummary(entry)} />
            {typeof entry.role === "string" && <RoleTag role={entry.role} />}
          </span>
          {datetime && (
            <time dateTime={datetime}>
              {copy.utcTime(datetime.slice(0, 16).replace("T", " "))}
            </time>
          )}
        </summary>
        {open && <FileValues value={entry} />}
      </details>
    </li>
  );
}

function Ledger({ text }: { text: string }) {
  const { entries, unreadable } = parseLedger(text);
  return (
    <>
      {unreadable > 0 && (
        <p className="files-muted">{copy.unreadableRows(unreadable)}</p>
      )}
      {entries.length > 0 ? (
        <ol className="files-ledger" aria-label={copy.ledgerList}>
          {entries.map(({ line, entry, timestamp }) => (
            <LedgerItem key={line} entry={entry} timestamp={timestamp} />
          ))}
        </ol>
      ) : (
        <p>{copy.ledgerEmpty}</p>
      )}
    </>
  );
}

export function FileDocument({
  file,
  registry,
}: {
  file: ProjectFile;
  registry: Map<string, ResourceEntry> | undefined;
}) {
  if (file.path === registryPath) return <RegistryTable registry={registry} />;
  const path = file.path.toLowerCase();
  if (path.endsWith(".jsonl")) return <Ledger text={file.text} />;
  if (path.endsWith(".json")) {
    const value = parseJson(file.text);
    return value === undefined ? (
      <p>{copy.invalidJson}</p>
    ) : (
      <FileValues value={value} />
    );
  }
  if (!path.endsWith(".md")) return <SafeMarkdown plain content={file.text} />;
  const chapter = /^chapters\/chapter-[^/]+\.md$/.test(path);
  return (
    <div
      className={
        chapter
          ? "files-prose files-chapter chapter-paper manuscript"
          : "files-prose"
      }
    >
      <SafeMarkdown content={file.text} />
    </div>
  );
}

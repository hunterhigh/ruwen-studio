"use client";
import { useState } from "react";
import { chapterCopy as c } from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import type { Detail } from "./review-data.ts";

/** Retains the existing file comparison and explicit memory approval until block 4. */
export function ExistingMemoryReview({
  data,
  readOnly,
  busy,
  onApprove,
}: {
  data: Detail;
  readOnly: boolean;
  busy: boolean;
  onApprove: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <section className="memory-review">
      <header>
        <h2>{c.memoryTitle}</h2>
        <p>{c.memoryIntro}</p>
      </header>
      {data.memoryFiles.length === 0 && <p>{c.memoryEmpty}</p>}
      {data.memoryFiles.map((file) => (
        <details key={file.path} open>
          <summary>
            <SafeMarkdown plain inline content={file.path} />
          </summary>
          <div className="file-diff">
            <section>
              <h3>{c.memoryBefore}</h3>
              <SafeMarkdown plain content={file.before} />
            </section>
            <section>
              <h3>{c.memoryAfter}</h3>
              <SafeMarkdown plain content={file.after} />
            </section>
          </div>
        </details>
      ))}
      {!readOnly && data.run.status === "AWAITING_MEMORY_APPROVAL" && (
        <div className="approval-bar">
          <div>
            <strong>{c.memoryQuestion}</strong>
            <label className="confirm-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {c.memoryConfirmed}
            </label>
          </div>
          <button
            className="button primary"
            type="button"
            disabled={!confirmed || busy || !data.run.memoryPreviewSha256}
            onClick={onApprove}
          >
            {busy ? c.approving : c.memorySubmit}
          </button>
        </div>
      )}
    </section>
  );
}

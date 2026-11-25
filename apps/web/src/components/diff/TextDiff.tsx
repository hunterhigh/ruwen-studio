"use client";
import { useMemo } from "react";
import { diffCopy as c } from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { type DiffBlock, diffText } from "./text-diff.ts";

export interface TextDiffProps {
  before: string;
  after: string;
  groupByHeading?: boolean;
}

function ChangeLine({
  kind,
  fragments,
}: {
  kind: "added" | "removed";
  fragments: { text: string; changed: boolean }[];
}) {
  const Mark = kind === "added" ? "ins" : "del";
  return (
    <div className={`text-diff-line is-${kind}`}>
      <span className="text-diff-label">
        {kind === "added" ? c.added : c.removed}
      </span>
      <div className="text-diff-content">
        {fragments.map(({ text, changed }, index) => {
          const content = <SafeMarkdown plain inline content={text} />;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: Identical fragments can recur in a snapshot.
            <span key={`${index}-${text}`}>
              {changed ? (
                <Mark className="text-diff-mark">{content}</Mark>
              ) : (
                content
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Block({ block }: { block: DiffBlock }) {
  if (block.kind === "same")
    return (
      <details className="text-diff-fold">
        <summary>{c.fold(block.paragraphs.length)}</summary>
        {block.paragraphs.map((text, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Repeated unchanged paragraphs have no IDs.
          <SafeMarkdown key={index} plain content={text} />
        ))}
      </details>
    );
  if (block.kind === "changed")
    return (
      <>
        <ChangeLine kind="removed" fragments={block.before} />
        <ChangeLine kind="added" fragments={block.after} />
      </>
    );
  return (
    <ChangeLine
      kind={block.kind}
      fragments={[{ text: block.text, changed: true }]}
    />
  );
}

export function TextDiff({ before, after, groupByHeading }: TextDiffProps) {
  const { groups } = useMemo(
    () => diffText(before, after, groupByHeading),
    [before, after, groupByHeading],
  );
  if (!groups.length) return <p className="text-diff-empty">{c.empty}</p>;
  return (
    <div className="text-diff">
      {groups.map(({ heading, kind, blocks }, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: Section headings can repeat in an immutable snapshot.
        <section key={index} className="text-diff-section">
          {heading &&
            (kind === "same" ? (
              <h4>
                <SafeMarkdown
                  plain
                  inline
                  content={heading.replace(/^\s*##\s+/, "")}
                />
              </h4>
            ) : (
              <ChangeLine
                kind={kind}
                fragments={[{ text: heading, changed: true }]}
              />
            ))}
          {blocks.map((block, offset) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: The display order belongs to an immutable snapshot.
            <Block key={offset} block={block} />
          ))}
        </section>
      ))}
    </div>
  );
}

"use client";
import type { InputManifest } from "@ruwen/core";
import { useLayoutEffect, useRef } from "react";
import { inputManifestCopy as c, chapterCopy } from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { roleInputsView } from "./input-manifest-view.ts";
import type { ChapterRole } from "./review-data.ts";

export function RoleInputPopover({
  role,
  manifest,
  fallback,
}: {
  role: ChapterRole;
  manifest: InputManifest | null | undefined;
  fallback: readonly [string, string] | undefined;
}) {
  const view = roleInputsView(manifest, role === "xiaoshuo-zuozhe");
  const fill = useRef<HTMLSpanElement>(null);
  const percent = view.kind === "record" ? view.packet?.percent : undefined;
  useLayoutEffect(() => {
    if (fill.current && percent !== undefined)
      fill.current.style.width = `${percent}%`;
  }, [percent]);

  if (view.kind === "legacy") {
    const memory = role === "jiyi-weihuyuan";
    return (
      <section className="chapter-role-popover">
        <h3>{chapterCopy.roleView}</h3>
        <p className="chapter-role-legacy">{view.notice}</p>
        <p>
          <strong>{memory ? chapterCopy.memorySees : chapterCopy.sees}</strong>{" "}
          {fallback?.[0]}
        </p>
        <p>
          <strong>
            {memory ? chapterCopy.memoryDoesNot : chapterCopy.cannotSee}
          </strong>{" "}
          {fallback?.[1]}
        </p>
      </section>
    );
  }
  const technical = view.seen.filter(({ path, sha256 }) => path || sha256);
  return (
    <section className="chapter-role-popover chapter-role-manifest">
      <div className="chapter-manifest-block">
        <h3>{c.seen}</h3>
        {view.seen.length ? (
          <ul>
            {view.seen.map(({ label, size }, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: One snapshot may repeat the same material.
              <li key={`${label}-${index}`}>
                <SafeMarkdown plain inline content={label} /> · {size}
              </li>
            ))}
          </ul>
        ) : (
          <p>{c.noMaterials}</p>
        )}
        {view.packet && (
          <div className="chapter-manifest-packet">
            <p>{view.packet.text}</p>
            {percent !== undefined && (
              <div className="chapter-manifest-budget" aria-hidden="true">
                <span ref={fill} />
              </div>
            )}
          </div>
        )}
      </div>
      <div className="chapter-manifest-block">
        <h3>{c.withheld}</h3>
        {view.withheld.length ? (
          <ul>
            {view.withheld.map(({ labels, reason }) => (
              <li key={`${reason}:${labels.join("/")}`}>
                {labels.length > 1 ? (
                  <>
                    <p>{reason}</p>
                    <ul className="chapter-manifest-tags">
                      {labels.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <strong>{labels[0]}</strong>——{reason}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>{c.noRestrictions}</p>
        )}
      </div>
      <div className="chapter-manifest-block">
        <h3>{c.rules}</h3>
        <p>{view.rules}</p>
      </div>
      {!!technical.length && (
        <details className="chapter-manifest-technical">
          <summary>{c.technical}</summary>
          <dl>
            {technical.map(({ label, path, sha256 }, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Reads of the same material can repeat.
              <div key={`${label}-${index}`}>
                <dt>
                  <SafeMarkdown plain inline content={label} />
                </dt>
                {path && (
                  <dd>
                    {c.path}{" "}
                    <code>
                      <SafeMarkdown plain inline content={path} />
                    </code>
                  </dd>
                )}
                {sha256 && (
                  <dd>
                    {c.hash}{" "}
                    <code>
                      <SafeMarkdown plain inline content={sha256} />
                    </code>
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}

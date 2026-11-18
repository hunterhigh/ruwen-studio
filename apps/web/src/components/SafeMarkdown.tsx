"use client";
import type { MouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { confirmation, uiCopy } from "../copy/zh-CN.ts";
import { useConfirm } from "../ui/ConfirmDialog.tsx";
export function safeLink(href: string | undefined) {
  if (!href) return undefined;
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
/** The sole renderer for user/model content. No HTML plugin, external image or caller-supplied renderer. */
export function SafeMarkdown({
  content,
  inline = false,
  plain = false,
  selection,
}: {
  content: string;
  inline?: boolean;
  plain?: boolean;
  selection?: { label: string; onSelect: (start: number, end: number) => void };
}) {
  const confirm = useConfirm();
  async function confirmExternal(event: MouseEvent<HTMLAnchorElement>) {
    const target = new URL(event.currentTarget.href);
    if (target.origin === window.location.origin) return;
    event.preventDefault();
    if (
      await confirm({
        ...confirmation.external,
        body: confirmation.external.body(target.origin),
      })
    ) {
      window.open(target.href, "_blank", "noopener,noreferrer");
    }
  }
  if (plain && selection) {
    const report = (event: React.SyntheticEvent<HTMLTextAreaElement>) =>
      selection.onSelect(
        event.currentTarget.selectionStart,
        event.currentTarget.selectionEnd,
      );
    return (
      <textarea
        className="plain-content verbatim-source"
        data-safe-markdown="text"
        readOnly
        aria-label={selection.label}
        value={content}
        rows={Math.min(8, Math.max(2, content.split("\n").length))}
        onSelect={report}
        onMouseUp={report}
        onKeyUp={report}
        onTouchEnd={report}
      />
    );
  }
  if (plain)
    return inline ? (
      <span data-safe-markdown="text">{content}</span>
    ) : (
      <pre className="plain-content" data-safe-markdown="text">
        {content}
      </pre>
    );
  const markdown = (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSanitize]}
      allowedElements={
        inline
          ? ["p", "a", "em", "strong", "del", "code", "br"]
          : [
              "p",
              "a",
              "em",
              "strong",
              "del",
              "code",
              "pre",
              "br",
              "blockquote",
              "ul",
              "ol",
              "li",
              "h1",
              "h2",
              "h3",
              "h4",
              "hr",
              "table",
              "thead",
              "tbody",
              "tr",
              "th",
              "td",
              "img",
            ]
      }
      unwrapDisallowed
      components={{
        p: ({ children }) =>
          inline ? <span>{children}</span> : <p>{children}</p>,
        a: ({ href, children }) => {
          const url = safeLink(href);
          return url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={confirmExternal}
              onAuxClick={(event) => {
                if (event.button === 1) confirmExternal(event);
              }}
            >
              {children}
            </a>
          ) : (
            <span>{children}</span>
          );
        },
        img: ({ alt }) => (
          <span className="hidden-image">{uiCopy.hiddenImage(alt)}</span>
        ),
      }}
      urlTransform={(url) => safeLink(url) ?? ""}
    >
      {content}
    </ReactMarkdown>
  );
  return inline ? (
    <span data-safe-markdown="inline">{markdown}</span>
  ) : (
    <div className="safe-markdown" data-safe-markdown="block">
      {markdown}
    </div>
  );
}

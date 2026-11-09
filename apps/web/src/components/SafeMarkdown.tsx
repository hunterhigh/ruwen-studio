import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
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
}: {
  content: string;
  inline?: boolean;
  plain?: boolean;
}) {
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
            <a href={url} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          );
        },
        img: ({ alt }) => (
          <span className="hidden-image">
            [图片已隐藏{alt ? `：${alt}` : ""}]
          </span>
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

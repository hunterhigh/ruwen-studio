import { SafeMarkdown } from "./SafeMarkdown.tsx";

const titleSegments = new Intl.Segmenter("zh-CN");

/** Decorative cover. The caller supplies a readable title beside it. */
export function BookCover({ id, title }: { id: string; title: string }) {
  let hash = 0;
  for (const character of id) {
    hash = Math.imul(31, hash) + character.charCodeAt(0);
  }
  const color = (hash >>> 0) % 6;
  const characters = Array.from(
    titleSegments.segment(title),
    ({ segment }) => segment,
  );
  const label =
    characters.length > 8 ? `${characters.slice(0, 8).join("")}…` : title;

  return (
    <div className={`book-cover cover-${color}`} aria-hidden="true">
      <span className="book-cover-spine" />
      <span className="book-cover-label">
        <SafeMarkdown plain inline content={label} />
      </span>
    </div>
  );
}

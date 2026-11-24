"use client";
import {
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  chapterCopy as c,
  changeKind,
  readerReaction,
  roleName,
} from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { locateEdits, readerPosition, type Span } from "./marks.ts";
import { chapterTitle, type Edit, type Reaction } from "./review-data.ts";

type Note = {
  id: string;
  label: string;
  reason: string;
  original: string;
  replacement?: string;
  position?: number | undefined;
  mark?: Span | undefined;
  hint?: string | undefined;
  edit: boolean;
};

function notesFor(
  prose: string,
  original: string,
  edits: Edit[],
  reactions: Reaction[],
  revised: boolean,
): Note[] {
  const ranges = locateEdits(original, edits);
  return [
    ...reactions.map((reaction, i) => {
      const match = readerPosition(reaction, original, prose, ranges);
      const mark = revised ? match.originalSpan : match.cleanSpan;
      return {
        id: `reader-${i}`,
        edit: false,
        original: reaction.anchor,
        reason: reaction.note,
        label:
          readerReaction[reaction.type as keyof typeof readerReaction] ??
          roleName["qinggan-duzhe"],
        mark,
        position: mark?.start ?? (revised ? undefined : match.fallback),
        hint: mark
          ? undefined
          : match.originalSpan && !revised
            ? c.deletedAnchor
            : c.missingAnchor,
      };
    }),
    ...edits.map((edit, i) => {
      const range = ranges.find((item) => item.index === i);
      return {
        id: `editor-${i}`,
        edit: true,
        label: changeKind[edit.kind],
        reason: edit.reason,
        original: edit.original,
        replacement: edit.replacement,
        position: revised ? range?.start : range?.cleanStart,
        mark: revised ? range : undefined,
        hint: range ? undefined : c.missingAnchor,
      };
    }),
  ];
}

// A replacement can cross paragraph breaks. Treat the entire replaced passage as one span.
function proseBlocks(source: string, notes: Note[]) {
  const boundaries = [
    ...source.matchAll(/\r?\n[\t \r]*\n(?:[\t \r]*\n)*/g),
  ].filter(
    (breakAt) =>
      !notes.some(
        (note) =>
          note.mark &&
          note.mark.start < breakAt.index + breakAt[0].length &&
          note.mark.end > breakAt.index,
      ),
  );
  let start = 0;
  const blocks: Span[] = [];
  for (const match of boundaries) {
    if (match.index > start) blocks.push({ start, end: match.index });
    start = match.index + match[0].length;
  }
  if (start < source.length) blocks.push({ start, end: source.length });
  return blocks;
}

export function Manuscript({
  prose,
  original,
  edits,
  reactions,
  revised,
  setRevised,
  chapter,
  title,
  candidate,
  approved,
  approvedAt,
  animateSeal,
  writing,
  end,
  complete,
}: {
  prose: string;
  original: string;
  edits: Edit[];
  reactions: Reaction[];
  revised: boolean;
  setRevised: (value: boolean) => void;
  chapter: string;
  title: string;
  candidate: boolean;
  approved: boolean;
  approvedAt?: string | undefined;
  animateSeal: boolean;
  writing: boolean;
  end: RefObject<HTMLDivElement | null>;
  complete: boolean;
}) {
  const [readerOn, showReader] = useState(true);
  const [editorOn, showEditor] = useState(true);
  const [expanded, setExpanded] = useState<string>();
  const anchors = useRef(new Map<string, HTMLElement>());
  const cards = useRef(new Map<string, HTMLElement>());
  const lane = useRef<HTMLElement>(null);
  const paper = useRef<HTMLElement>(null);
  const source = revised && original ? original : prose;
  const notes = useMemo(
    () =>
      notesFor(prose, original, edits, reactions, revised && Boolean(original)),
    [prose, original, edits, reactions, revised],
  );
  const visible = notes.filter((note) => (note.edit ? editorOn : readerOn));
  const blocks = proseBlocks(source, notes);
  const first = blocks[0];
  if (first && title !== chapter) {
    const line = source.slice(first.start, first.end).trim();
    if (
      !line.includes("\n") &&
      chapterTitle(line) === title &&
      !notes.some(
        (note) => note.position !== undefined && note.position < first.end,
      )
    )
      blocks.shift();
  }

  const placeNotes = useCallback(() => {
    if (!lane.current) return;
    const top = lane.current.getBoundingClientRect().top;
    const positions = [...cards.current]
      .map(([id, element]) => ({
        element,
        top: Math.max(
          0,
          (anchors.current.get(id)?.getBoundingClientRect().top ?? top) - top,
        ),
      }))
      .sort((a, b) => a.top - b.top);
    let next = 0;
    for (const position of positions) {
      const y = Math.max(next, position.top);
      position.element.style.top = `${y}px`;
      next = y + position.element.offsetHeight + 10;
    }
    lane.current.style.minHeight = `${next}px`;
  }, []);

  useLayoutEffect(placeNotes);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(placeNotes);
    if (paper.current) observer.observe(paper.current);
    window.addEventListener("resize", placeNotes);
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) placeNotes();
    });
    return () => {
      active = false;
      observer.disconnect();
      window.removeEventListener("resize", placeNotes);
    };
  }, [placeNotes]);

  function activate(note: Note, fromText: boolean) {
    const next = expanded === note.id ? undefined : note.id;
    setExpanded(next);
    if (next && note.edit && !revised && original) setRevised(true);
    if (next)
      requestAnimationFrame(() => {
        const target = fromText
          ? cards.current.get(note.id)
          : (anchors.current.get(note.id) ?? paper.current);
        target?.scrollIntoView({
          block: "center",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      });
  }

  return (
    <>
      {!writing && source && (
        <div className="chapter-tools">
          <div className="chapter-segment">
            <button
              type="button"
              aria-pressed={!revised}
              onClick={() => setRevised(false)}
            >
              {c.clean}
            </button>
            <button
              type="button"
              aria-pressed={revised}
              disabled={!original}
              onClick={() => setRevised(true)}
            >
              {c.revised}
            </button>
          </div>
          <div className="chapter-note-toggles">
            <span>{c.notes}</span>
            <button
              type="button"
              aria-pressed={readerOn}
              onClick={() => showReader(!readerOn)}
            >
              {c.reader(reactions.length)}
            </button>
            <button
              type="button"
              aria-pressed={editorOn}
              onClick={() => showEditor(!editorOn)}
            >
              {c.editor(edits.length)}
            </button>
          </div>
        </div>
      )}
      <div className="chapter-reading">
        <article className="manuscript chapter-paper" ref={paper}>
          {approved && (
            <div className={`chapter-stamp${animateSeal ? " is-new" : ""}`}>
              <strong>{c.seal}</strong>
              <small>{chapter}</small>
            </div>
          )}
          <div className="manuscript-meta chapter-paper-meta">
            <span>
              {approved
                ? c.approvedText(chapter)
                : candidate
                  ? c.candidate
                  : writing
                    ? c.streaming
                    : c.draft}
              {approvedAt && (
                <time dateTime={approvedAt}>
                  {" "}
                  · {c.passedAt(new Date(approvedAt).toLocaleString("zh-CN"))}
                </time>
              )}
            </span>
            <span>{c.chars(Array.from(source).length)}</span>
          </div>
          <h2>
            <SafeMarkdown plain inline content={title} />
          </h2>
          {blocks.length ? (
            blocks.map(({ start, end }, index) => {
              const previousEnd = blocks[index - 1]?.end ?? 0;
              const here = visible.filter(
                (note) =>
                  note.position !== undefined &&
                  note.position >= previousEnd &&
                  (index === blocks.length - 1 || note.position < end),
              );
              const marked = here.filter(
                (note) =>
                  note.mark && note.mark.start >= start && note.mark.end <= end,
              );
              const activeEdits = marked.filter((note) => note.edit);
              const edges = [
                ...new Set([
                  start,
                  end,
                  ...marked.flatMap((note) =>
                    note.mark &&
                    (note.edit ||
                      !activeEdits.some(
                        (edit) =>
                          edit.mark &&
                          note.mark &&
                          note.mark.start < edit.mark.end &&
                          edit.mark.start < note.mark.end,
                      ))
                      ? [note.mark.start, note.mark.end]
                      : [],
                  ),
                ]),
              ].sort((a, b) => a - b);
              return (
                // Offsets belong to one immutable draft; the streaming draft only appends or resets.
                <div className="prose-paragraph chapter-paragraph" key={start}>
                  {here
                    .filter(
                      (note) =>
                        !note.mark ||
                        !marked.includes(note) ||
                        (!note.edit &&
                          activeEdits.some(
                            (edit) =>
                              edit.mark &&
                              note.mark &&
                              note.mark.start < edit.mark.end &&
                              edit.mark.start < note.mark.end,
                          )),
                    )
                    .map((note) => (
                      <span
                        key={note.id}
                        ref={(node) => {
                          if (node) anchors.current.set(note.id, node);
                          else anchors.current.delete(note.id);
                        }}
                      />
                    ))}
                  {edges.slice(0, -1).map((position, edge) => {
                    const stop = edges[edge + 1];
                    const edit = activeEdits.find(
                      (note) => note.mark?.start === position,
                    );
                    const readers = marked.filter(
                      (note) =>
                        !note.edit &&
                        note.mark &&
                        note.mark.start <= position &&
                        note.mark.end >= (stop ?? end),
                    );
                    const note =
                      edit ??
                      readers.find((item) => item.id === expanded) ??
                      readers[0];
                    const body = (
                      <SafeMarkdown
                        plain
                        inline
                        content={source.slice(position, stop)}
                      />
                    );
                    if (!note) return <span key={position}>{body}</span>;
                    const linked = edit
                      ? [edit]
                      : readers.filter((item) => item.mark?.start === position);
                    return (
                      <button
                        type="button"
                        key={position}
                        className={`chapter-inline-mark ${edit ? "chapter-edit-mark" : "chapter-reader-mark"}`}
                        aria-pressed={note.id === expanded}
                        onClick={() => activate(note, true)}
                        ref={(node) => {
                          for (const item of linked) {
                            if (node) anchors.current.set(item.id, node);
                            else anchors.current.delete(item.id);
                          }
                        }}
                      >
                        {edit ? (
                          <>
                            <del>{body}</del>
                            <ins>
                              <SafeMarkdown
                                plain
                                inline
                                content={edit.replacement ?? ""}
                              />
                            </ins>
                          </>
                        ) : (
                          <mark>{body}</mark>
                        )}
                      </button>
                    );
                  })}
                  {writing && index === blocks.length - 1 && (
                    <span className="chapter-cursor" aria-hidden="true" />
                  )}
                </div>
              );
            })
          ) : (
            <p className="manuscript-empty">{c.awaitingDraft}</p>
          )}
          {complete && (
            <div className="chapter-end" ref={end}>
              {c.end}
            </div>
          )}
        </article>
        <aside className="chapter-note-lane" ref={lane} aria-label={c.notes}>
          {writing || !source ? (
            <p>{c.awaitingNotes}</p>
          ) : (
            !visible.length && <p>{c.noNotes}</p>
          )}
          {visible.map((note) => (
            <section
              key={note.id}
              className={`chapter-note ${note.edit ? "is-editor" : "is-reader"}`}
              ref={(node) => {
                if (node) cards.current.set(note.id, node);
                else cards.current.delete(note.id);
              }}
            >
              <button
                type="button"
                className="chapter-note-toggle"
                aria-expanded={expanded === note.id}
                onClick={() => activate(note, false)}
              >
                <strong>
                  {roleName[note.edit ? "wenxue-bianji" : "qinggan-duzhe"]} ·{" "}
                  {note.label}
                </strong>
                <span className="chapter-note-reason">
                  <SafeMarkdown plain inline content={note.reason} />
                </span>
                {note.hint && !note.edit && (
                  <>
                    <q>
                      <SafeMarkdown plain inline content={note.original} />
                    </q>
                    <small>{note.hint}</small>
                  </>
                )}
              </button>
              {(expanded === note.id || (note.edit && note.hint)) && (
                <div className="chapter-note-detail">
                  {note.edit ? (
                    <>
                      <p>
                        {c.before}{" "}
                        <del>
                          <SafeMarkdown plain inline content={note.original} />
                        </del>
                      </p>
                      <p>
                        {c.after}{" "}
                        <ins>
                          <SafeMarkdown
                            plain
                            inline
                            content={note.replacement || c.deleted}
                          />
                        </ins>
                      </p>
                      {note.hint && <small>{note.hint}</small>}
                    </>
                  ) : (
                    !note.hint && (
                      <q>
                        <SafeMarkdown plain inline content={note.original} />
                      </q>
                    )
                  )}
                </div>
              )}
            </section>
          ))}
        </aside>
      </div>
    </>
  );
}

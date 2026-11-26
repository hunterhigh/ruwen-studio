"use client";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import {
  annotationCopy as a,
  chapterCopy as c,
  changeKind,
  readerReaction,
  roleName,
} from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";
import { AnnotationCard, AnnotationHeader } from "./AnnotationCard.tsx";
import { AnnotationRail } from "./AnnotationRail.tsx";
import {
  locateEdits,
  readerPosition,
  type Span,
  uniquePosition,
} from "./marks.ts";
import {
  type AnnotationView,
  markerFraction,
  type ReviewAnnotations,
  showsAnnotation,
} from "./review-annotations.ts";
import { chapterTitle } from "./review-data.ts";
import type { AnnotationReview } from "./useAnnotationReview.ts";

type Note = {
  id: string;
  annotation: AnnotationView;
  ordinal: number;
  label: string;
  reason: string;
  original: string;
  replacement?: string;
  position?: number | undefined;
  markerPosition?: number | undefined;
  mark?: Span | undefined;
  hint?: string | undefined;
  edit: boolean;
};

function notesFor(
  prose: string,
  original: string,
  reviews: ReviewAnnotations,
  revised: boolean,
  currentUserVersion: boolean,
): Note[] {
  const edits = reviews.editors.map(({ finding }) => finding);
  const ranges = locateEdits(original, edits);
  const source = revised && original && !currentUserVersion ? original : prose;
  const currentRanges = currentUserVersion
    ? locateEdits(
        prose,
        reviews.editors.map(({ finding: edit, annotation }) =>
          annotation.status === "dismissed"
            ? edit
            : {
                ...edit,
                original: edit.replacement,
                replacement: edit.original,
              },
        ),
      )
    : ranges;
  return [
    ...reviews.readers.map(({ finding: reaction, annotation }) => {
      const match = readerPosition(reaction, original, prose, ranges);
      const mark =
        revised && !currentUserVersion ? match.originalSpan : match.cleanSpan;
      return {
        id: annotation.id,
        annotation,
        ordinal: reaction.sourceIndex + 1,
        edit: false,
        original: reaction.anchor,
        reason: reaction.note,
        label:
          readerReaction[reaction.type as keyof typeof readerReaction] ??
          roleName["qinggan-duzhe"],
        mark,
        markerPosition: uniquePosition(source, reaction.anchor),
        position:
          mark?.start ??
          (revised || currentUserVersion ? undefined : match.fallback),
        hint: mark
          ? undefined
          : match.originalSpan && !revised && !currentUserVersion
            ? c.deletedAnchor
            : c.missingAnchor,
      };
    }),
    ...reviews.editors.map(({ finding: edit, annotation }, i) => {
      const range = currentRanges.find((item) => item.index === i);
      const reverted = annotation.status === "dismissed";
      return {
        id: annotation.id,
        annotation,
        ordinal: edit.sourceIndex + 1,
        edit: true,
        label: changeKind[edit.kind],
        reason: edit.reason,
        original: edit.original,
        replacement: edit.replacement,
        position:
          revised || currentUserVersion ? range?.start : range?.cleanStart,
        mark: revised && !reverted ? range : undefined,
        markerPosition: range
          ? uniquePosition(
              source,
              reverted || (revised && !currentUserVersion)
                ? edit.original
                : edit.replacement,
            )
          : undefined,
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
  reviews,
  review,
  canEditAnnotations,
  onEditCandidate,
  revised,
  setRevised,
  currentUserVersion,
  controls,
  alternate,
  note,
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
  reviews: ReviewAnnotations;
  review: AnnotationReview;
  canEditAnnotations: boolean;
  onEditCandidate: () => void;
  revised: boolean;
  setRevised: (value: boolean) => void;
  currentUserVersion: boolean;
  controls: ReactNode;
  alternate: ReactNode;
  note: ReactNode;
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
  const { active: expanded, setActive: setExpanded } = review;
  const anchors = useRef(new Map<string, HTMLElement>());
  const cards = useRef(new Map<string, HTMLElement>());
  const lane = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLElement>(null);
  const source = revised && original && !currentUserVersion ? original : prose;
  const showingAlternate = Boolean(alternate);
  const notes = useMemo(
    () => notesFor(prose, original, reviews, revised, currentUserVersion),
    [prose, original, reviews, revised, currentUserVersion],
  );
  const visible = notes.filter(({ annotation }) =>
    showsAnnotation(annotation, review.filter),
  );
  const verificationIssues = reviews.verdicts.flatMap(({ role, issues }) =>
    issues
      .filter(({ annotation }) => showsAnnotation(annotation, review.filter))
      .map(({ finding, annotation }) => ({
        annotation,
        position: uniquePosition(source, finding.evidence ?? ""),
        label: a.locate(roleName[role], finding.sourceIndex + 1),
      })),
  );
  const markers = [
    ...visible.map(
      ({ annotation, edit, markerPosition: position, ordinal }) => ({
        annotation,
        position,
        label: a.locate(
          roleName[edit ? "wenxue-bianji" : "qinggan-duzhe"],
          ordinal,
        ),
      }),
    ),
    ...verificationIssues,
  ].flatMap(({ annotation, position, label }) => {
    const fraction = markerFraction(position, source.length);
    return fraction === undefined ? [] : [{ annotation, fraction, label }];
  });
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
    if (showingAlternate) return;
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
  }, [placeNotes, showingAlternate]);

  function activate(note: Note, fromText: boolean) {
    const next = expanded === note.id ? undefined : note.id;
    setExpanded(next);
    if (next && note.edit && !revised && (original || currentUserVersion))
      setRevised(true);
    if (next) scrollToAnnotation(note.id, fromText);
  }

  function scrollToAnnotation(id: string, fromText: boolean) {
    requestAnimationFrame(() => {
      const target = fromText
        ? cards.current.get(id)
        : (anchors.current.get(id) ?? paper.current);
      target?.scrollIntoView({
        block: "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    });
  }

  const tools = !writing && source && (
    <div className="chapter-tools">{controls}</div>
  );
  if (showingAlternate)
    return (
      <>
        {tools}
        <div className="chapter-alternate">{alternate}</div>
      </>
    );
  return (
    <>
      {tools}
      <div className="chapter-reading">
        <article className="manuscript chapter-paper" ref={paper}>
          {!writing && markers.length > 0 && (
            <AnnotationRail
              paper={paper}
              markers={markers}
              active={expanded}
              onActivate={(id) => {
                setExpanded(id);
                scrollToAnnotation(id, false);
              }}
            />
          )}
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
          {note}
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
                  {verificationIssues
                    .filter(
                      ({ position }) =>
                        position !== undefined &&
                        position >= previousEnd &&
                        (index === blocks.length - 1 || position < end),
                    )
                    .map(({ annotation }) => (
                      <span
                        key={annotation.id}
                        ref={(node) => {
                          if (node) anchors.current.set(annotation.id, node);
                          else anchors.current.delete(annotation.id);
                        }}
                      />
                    ))}
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
                            <del>
                              <SafeMarkdown
                                plain
                                inline
                                content={edit.original}
                              />
                            </del>
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
        <aside className="chapter-note-lane" aria-label={c.notes}>
          {!writing && reviews.all.length > 0 && (
            <AnnotationHeader notes={reviews.all} review={review} />
          )}
          {verificationIssues.length > 0 && (
            <a className="chapter-annotation-jump" href="#chapter-verification">
              {a.viewVerification}
            </a>
          )}
          <div className="chapter-note-list" ref={lane}>
            {writing || !source ? (
              <p>{c.awaitingNotes}</p>
            ) : (
              !visible.length &&
              !verificationIssues.length && (
                <p>{review.filter === "all" ? c.noNotes : a.emptyFilter}</p>
              )
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
                <AnnotationCard
                  note={note.annotation}
                  label={`${roleName[note.edit ? "wenxue-bianji" : "qinggan-duzhe"]} · ${note.label}`}
                  summary={note.reason}
                  review={review}
                  canEdit={canEditAnnotations}
                  onToggle={() => activate(note, false)}
                  onEdit={onEditCandidate}
                >
                  {note.edit ? (
                    <div className="chapter-note-detail">
                      <div className="chapter-note-edit-preview">
                        <del>
                          <SafeMarkdown plain inline content={note.original} />
                        </del>
                        <ins>
                          <SafeMarkdown
                            plain
                            inline
                            content={note.replacement || c.deleted}
                          />
                        </ins>
                      </div>
                      {note.hint && <small>{note.hint}</small>}
                    </div>
                  ) : (
                    (note.hint || expanded === note.id) && (
                      <div className="chapter-note-detail">
                        <q>
                          <SafeMarkdown plain inline content={note.original} />
                        </q>
                        {note.hint && <small>{note.hint}</small>}
                      </div>
                    )
                  )}
                </AnnotationCard>
              </section>
            ))}
          </div>
        </aside>
      </div>
    </>
  );
}

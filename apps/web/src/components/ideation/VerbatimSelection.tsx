"use client";
import type {
  IdeationCreateVerbatimPreview,
  IdeationMessage,
  IdeationResourceId,
} from "@ruwen/pipeline";
import { useLayoutEffect, useRef, useState } from "react";
import { ideationCopy as c } from "../../copy/zh-CN.ts";
import { SafeMarkdown } from "../SafeMarkdown.tsx";

/** A browser selection uses UTF-16; the contract accepts whole Unicode codepoints only. */
export function codepointSelection(text: string, start: number, end: number) {
  // A textarea normalizes CRLF/CR to LF. Map its offsets back to the authoritative string.
  const offsets = [0];
  for (let i = 0; i < text.length; ) {
    i += text[i] === "\r" && text[i + 1] === "\n" ? 2 : 1;
    offsets.push(i);
  }
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end >= offsets.length
  )
    return null;
  start = offsets[start] ?? -1;
  end = offsets[end] ?? -1;
  const boundary = (at: number) =>
    at === 0 ||
    at === text.length ||
    !(
      text.charCodeAt(at - 1) >= 0xd800 &&
      text.charCodeAt(at - 1) <= 0xdbff &&
      text.charCodeAt(at) >= 0xdc00 &&
      text.charCodeAt(at) <= 0xdfff
    );
  if (!boundary(start) || !boundary(end)) return null;
  return {
    start: Array.from(text.slice(0, start)).length,
    end: Array.from(text.slice(0, end)).length,
    text: text.slice(start, end),
  };
}
export interface VerbatimTargetOption {
  id: string;
  path: string;
}
export function VerbatimSelection({
  message,
  targets,
  busy,
  onChoose,
}: {
  message: IdeationMessage;
  targets: readonly VerbatimTargetOption[];
  busy: boolean;
  onChoose: (
    request: Omit<IdeationCreateVerbatimPreview, "clientRequestId">,
  ) => void;
}) {
  const [selected, setSelected] =
    useState<ReturnType<typeof codepointSelection>>(null);
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  const toolbar = useRef<HTMLDivElement>(null);
  const selectionTop = useRef(0);
  useLayoutEffect(() => {
    const tools = toolbar.current;
    const wrapper = tools?.parentElement;
    const viewport = wrapper?.closest(".ideation-messages");
    if (!selected || !tools || !wrapper || !viewport) return;
    const minimum =
      viewport.getBoundingClientRect().top +
      4 -
      wrapper.getBoundingClientRect().top;
    tools.style.top = `${Math.max(minimum, selectionTop.current - tools.offsetHeight - 4)}px`;
  }, [selected]);
  if (message.role !== "user") return null;
  const count = selected ? selected.end - selected.start : 0;
  const choose = (kind: "current_chapter" | "resource_file") => {
    if (
      !selected ||
      busy ||
      (kind === "current_chapter" && count > 600) ||
      (kind === "resource_file" && !targets.some((t) => t.id === target))
    )
      return;
    onChoose({
      messageId: message.id,
      start: selected.start,
      end: selected.end,
      target:
        kind === "current_chapter"
          ? { kind }
          : { kind, resourceId: target as IdeationResourceId },
    });
  };
  return (
    <div
      className="verbatim-selection"
      onPointerUp={(event) => {
        if (event.target instanceof HTMLTextAreaElement)
          selectionTop.current = Math.max(
            0,
            event.clientY -
              event.currentTarget.getBoundingClientRect().top -
              12,
          );
      }}
    >
      <SafeMarkdown
        plain
        content={message.content}
        selection={{
          label: c.verbatimSelection,
          onSelect: (start, end) =>
            setSelected(codepointSelection(message.content, start, end)),
        }}
      />
      {selected && (
        <div ref={toolbar} className="ideation-verbatim-tools">
          <strong>{c.verbatimToolbar}</strong>
          <p className="fine-print" aria-live="polite">
            {c.countForChapter(count)}
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={!selected || busy || count > 600}
            onClick={() => choose("current_chapter")}
          >
            {c.verbatimChapter}
          </button>
          <label>
            {c.verbatimFileTarget}
            <select
              aria-label={c.verbatimFileTarget}
              value={target}
              disabled={busy || !targets.length}
              onChange={(e) => setTarget(e.target.value)}
            >
              {targets.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.path}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={!selected || busy || !target}
            onClick={() => choose("resource_file")}
          >
            {c.verbatimFile}
          </button>
        </div>
      )}
    </div>
  );
}

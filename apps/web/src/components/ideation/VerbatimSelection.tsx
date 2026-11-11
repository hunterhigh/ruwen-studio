"use client";
import type {
  IdeationCreateVerbatimPreview,
  IdeationMessage,
  IdeationResourceId,
} from "@ruwen/pipeline";
import { useState } from "react";
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
    <>
      <SafeMarkdown
        plain
        content={message.content}
        selection={{
          label: "你的消息原文，可选中文字",
          onSelect: (start, end) =>
            setSelected(codepointSelection(message.content, start, end)),
        }}
      />
      <details className="verbatim-actions" open={!!selected}>
        <summary>选中文字，逐字保留</summary>
        <p className="fine-print" aria-live="polite">
          {count} / 600 字（按码点计，含标点、空白和换行；本章上限）
        </p>
        {selected && <SafeMarkdown plain content={selected.text} />}
        <button
          type="button"
          className="button secondary"
          disabled={!selected || busy || count > 600}
          onClick={() => choose("current_chapter")}
        >
          逐字保留到本章
        </button>
        <label>
          写入目标文件
          <select
            aria-label="逐字写入的目标文件"
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
        {!targets.length && (
          <p className="fine-print">当前没有可选的授权文件。</p>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={!selected || busy || !target}
          onClick={() => choose("resource_file")}
        >
          逐字写入文件
        </button>
        <p className="fine-print">
          先生成预览，再由你批准；不会调用模型。需要改选区或目标时，拒绝旧预览后重新选择。
        </p>
      </details>
    </>
  );
}

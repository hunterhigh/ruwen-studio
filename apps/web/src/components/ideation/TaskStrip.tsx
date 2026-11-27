"use client";
import type { IdeationPreviewId, IdeationTask } from "@ruwen/pipeline";
import { useEffect, useRef, useState } from "react";
import {
  ideationCopy as c,
  roleName,
  statusCopy,
  taskStatus,
} from "../../copy/zh-CN.ts";
import { displayError } from "../../ui/error-text.ts";
import { InlineNotice } from "../../ui/InlineNotice.tsx";

export function TaskStrip({
  tasks,
  busy,
  onPreview,
  onCancel,
}: {
  tasks: readonly IdeationTask[];
  busy: boolean;
  onPreview: (id: IdeationPreviewId) => void;
  onCancel: (task: IdeationTask) => void;
}) {
  const downstream = tasks.filter(({ stage }) => stage !== "coordinator");
  const [open, setOpen] = useState<string>();
  const box = useRef<HTMLElement>(null);
  const selected = downstream.find(({ id }) => id === open);
  const previews = selected?.outputPreviewIds.length
    ? selected.outputPreviewIds
    : selected?.sourcePreviewId
      ? [selected.sourcePreviewId]
      : [];
  useEffect(() => {
    if (!selected) return;
    const outside = (event: PointerEvent) => {
      if (
        !document.querySelector("dialog[open]") &&
        event.target instanceof Node &&
        !box.current?.contains(event.target)
      )
        setOpen(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]"))
        setOpen(undefined);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [selected]);
  if (!downstream.length) return null;
  return (
    <section className="ideation-task-strip" aria-label={c.tasks} ref={box}>
      <div className="ideation-task-pills">
        {downstream.map((task) => (
          <button
            key={task.id}
            type="button"
            aria-expanded={open === task.id}
            onClick={() => setOpen(open === task.id ? undefined : task.id)}
          >
            <i aria-hidden="true" data-running={task.status === "RUNNING"} />
            {c.taskCaption(roleName[task.role], taskStatus[task.status])}
          </button>
        ))}
      </div>
      {selected && (
        <article className="ideation-task-popover">
          <strong>{roleName[selected.role]}</strong>
          <span>{taskStatus[selected.status]}</span>
          {selected.error && (
            <InlineNotice
              message={displayError(selected.error.code)}
              onAction={() => setOpen(undefined)}
              actionLabel={statusCopy.dismiss}
            />
          )}
          <div className="decision-actions">
            {previews.map((id, index) => (
              <button
                key={id}
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() => onPreview(id)}
              >
                {previews.length > 1
                  ? c.viewPreviewNumber(index + 1)
                  : c.viewPreview}
              </button>
            ))}
            {!["SUCCEEDED", "CANCELLED", "FAILED", "INTERRUPTED"].includes(
              selected.status,
            ) && (
              <button
                type="button"
                className="ui-btn ui-btn-danger-text"
                disabled={busy}
                onClick={() => onCancel(selected)}
              >
                {c.cancel}
              </button>
            )}
          </div>
        </article>
      )}
    </section>
  );
}

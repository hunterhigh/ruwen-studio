"use client";
import { useRef, useState } from "react";
import { ApiError, request } from "../client.ts";
import type {
  AnnotationFilter,
  AnnotationRevision,
  AnnotationView,
  FeedbackPatch,
} from "./review-annotations.ts";
import type { Detail } from "./review-data.ts";

type Failure = "unlocated" | "conflict" | "update" | "refresh" | "rate";

function revisionFailure(error: unknown, id: string): Failure {
  if (error instanceof ApiError && error.status === 409) {
    const details = error.details;
    if (
      details &&
      typeof details === "object" &&
      "editIds" in details &&
      Array.isArray(details.editIds) &&
      details.editIds.includes(id)
    )
      return "unlocated";
    return "conflict";
  }
  return error instanceof ApiError && error.status === 429 ? "rate" : "update";
}

export function useAnnotationReview({
  runId,
  refresh,
  revise,
  reload,
}: {
  runId: string;
  refresh: () => Promise<Detail | undefined>;
  revise: (id: string, op: AnnotationRevision) => Promise<boolean>;
  reload: () => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<AnnotationFilter>("all");
  const [active, setActive] = useState<string>();
  const [failure, setFailure] = useState<{ id: string; kind: Failure }>();
  const [pending, setPending] = useState(false);
  const running = useRef(false);

  async function perform(id: string, work: () => Promise<Failure | undefined>) {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      const kind = await work();
      if (kind) {
        setFailure({ id, kind });
        setActive(id);
      }
    } finally {
      setPending(false);
      running.current = false;
    }
  }

  return {
    filter,
    setFilter,
    active,
    setActive,
    failure,
    clearFailure: () => setFailure(undefined),
    pending,
    async update(note: AnnotationView, patch: FeedbackPatch) {
      if (!note.persisted) return;
      await perform(note.id, async () => {
        try {
          await request(
            `/api/runs/${runId}/annotations/${encodeURIComponent(note.id)}`,
            {
              method: "PUT",
              body: JSON.stringify(patch),
            },
          );
          if (!(await refresh())) return "refresh";
          if (patch.status)
            setActive((current) => (current === note.id ? undefined : current));
        } catch (error) {
          return error instanceof ApiError && error.status === 429
            ? "rate"
            : "update";
        }
      });
    },
    async changeEdit(note: AnnotationView) {
      if (!note.persisted || note.kind !== "editor") return;
      await perform(note.id, async () => {
        try {
          if (
            await revise(
              note.id,
              note.status === "dismissed"
                ? "reapply_editor_edits"
                : "revert_editor_edits",
            )
          )
            setActive((current) => (current === note.id ? undefined : current));
        } catch (error) {
          return revisionFailure(error, note.id);
        }
      });
    },
    async reload(id: string) {
      await perform(id, async () =>
        (await reload())
          ? undefined
          : failure?.kind === "conflict"
            ? "conflict"
            : "refresh",
      );
    },
  };
}

export type AnnotationReview = ReturnType<typeof useAnnotationReview>;

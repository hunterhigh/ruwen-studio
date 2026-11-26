"use client";
import { useCallback, useEffect, useState } from "react";
import { candidateCopy as c, errorCopy } from "../../copy/zh-CN.ts";
import { useConfirm } from "../../ui/ConfirmDialog.tsx";
import { ApiError, post } from "../client.ts";
import { useDraftLeave } from "./draft-navigation.ts";
import type { AnnotationRevision } from "./review-annotations.ts";
import type { Detail } from "./review-data.ts";

function saveError(cause: unknown) {
  if (!(cause instanceof ApiError)) return c.saveFailed;
  if (cause.status === 413) return c.tooLong;
  if (cause.status === 429) return c.rateLimited;
  if (cause.status === 400)
    return cause.message === c.metaTextResponse ? c.metaText : c.invalidText;
  return c.saveFailed;
}

export function useCandidateActions(
  id: string,
  data: Detail | undefined,
  waiting: boolean,
  refresh: () => Promise<Detail | undefined>,
) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState<{
    baseSha256: string;
    original: string;
    text: string;
  }>();
  const [saving, setSaving] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [startingCheck, setStartingCheck] = useState(false);
  const [checkNeedsRefresh, setCheckNeedsRefresh] = useState(false);
  const [checkError, setCheckError] = useState("");
  const dirty = !!draft && draft.text !== draft.original;
  const digest = data?.run.candidateSha256;
  const check = data?.run.reverification;
  const pendingCheck =
    waiting && check?.status === "pending" && check.sha256 === digest;
  const checking = startingCheck || checkNeedsRefresh || pendingCheck;
  const conflicted =
    conflict || Boolean(draft && (!waiting || draft.baseSha256 !== digest));

  const discard = useCallback(() => {
    setDraft(undefined);
    setConflict(false);
    setDraftError("");
  }, []);
  const confirmDiscard = useCallback(
    () => (dirty ? confirm(c.discardConfirmation) : Promise.resolve(true)),
    [confirm, dirty],
  );
  const leave = useCallback(async () => {
    if (saving || !(await confirmDiscard())) return false;
    discard();
    return true;
  }, [confirmDiscard, discard, saving]);
  useDraftLeave(dirty, leave);

  // The parent run's SSE does not publish the independent verifier task.
  useEffect(() => {
    if (!pendingCheck && !checkNeedsRefresh) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const detail = await refresh();
      if (!active) return;
      if (detail) setCheckNeedsRefresh(false);
      timer = setTimeout(poll, 1200);
    }
    timer = setTimeout(poll, 1200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [checkNeedsRefresh, pendingCheck, refresh]);

  async function reload() {
    if (saving || !(await confirmDiscard())) return false;
    setSaving(true);
    const next = await refresh();
    if (next) {
      setNeedsRefresh(false);
      discard();
    }
    setSaving(false);
    return Boolean(next);
  }

  async function persistRevision(
    baseSha256: string,
    input: { text: string } | { op: AnnotationRevision; editIds: string[] },
  ) {
    setSaving(true);
    try {
      await post(`/api/runs/${id}/candidate/revisions`, {
        baseSha256,
        ...input,
      });
      discard();
      setNeedsRefresh(!(await refresh()));
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    if (!draft || !dirty || saving || conflicted) return;
    if (!draft.text.trim()) {
      setDraftError(c.empty);
      return;
    }
    setDraftError("");
    try {
      await persistRevision(draft.baseSha256, { text: draft.text });
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setConflict(true);
      else setDraftError(saveError(cause));
    }
  }

  async function reverify() {
    if (!waiting || !digest || checking) return;
    if (!(await confirm(c.reverifyConfirmation))) return;
    setStartingCheck(true);
    setCheckError("");
    try {
      await post(`/api/runs/${id}/reverify`, { expectedSha256: digest });
      setCheckNeedsRefresh(!(await refresh()));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setCheckError(c.reverifyConflict);
        await refresh();
      } else if (cause instanceof ApiError && cause.status === 429) {
        setCheckError(c.rateLimited);
      } else {
        setCheckError(
          cause instanceof ApiError && cause.code
            ? (errorCopy[cause.code as keyof typeof errorCopy] ??
                c.reverifyFailed)
            : c.reverifyFailed,
        );
      }
    } finally {
      setStartingCheck(false);
    }
  }

  return {
    draft,
    dirty,
    conflicted,
    saving,
    needsRefresh,
    draftError,
    leave,
    reload,
    save,
    async editAnnotation(editId: string, op: AnnotationRevision) {
      if (!digest || !waiting || saving || needsRefresh || draft) return false;
      await persistRevision(digest, { op, editIds: [editId] });
      return true;
    },
    reverify,
    checking,
    checkError:
      checkError ||
      (waiting &&
      check?.sha256 === digest &&
      (check?.status === "failed" || check?.status === "cancelled")
        ? c.reverifyFailed
        : ""),
    startEditing() {
      if (digest && waiting && data?.prose)
        setDraft({
          baseSha256: digest,
          original: data.prose,
          text: data.prose,
        });
    },
    changeDraft(text: string) {
      setDraft((current) => current && { ...current, text });
      setDraftError("");
    },
  };
}

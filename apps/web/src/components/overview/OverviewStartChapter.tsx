"use client";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { chapterCopy as c, errorCopy, overviewCopy } from "../../copy/zh-CN.ts";
import { ApiError, post } from "../client.ts";
import { useApi } from "../useApi.ts";
import { runHref } from "./overview-data.ts";

export function OverviewStartChapter({
  root,
  initial,
  close,
}: {
  root: string;
  initial: number;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { data, error: settingsError } = useApi<{ scenarios: string[] }>(
    "/api/settings",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scenarios = data?.scenarios ?? [];
  useEffect(() => {
    const trigger = document.activeElement;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || (!data && !settingsError)) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const run = await post<{ id: string }>(`/api${root}/chapters`, {
        chapter: form.get("chapter"),
        ...(scenarios.length ? { simulation: form.get("simulation") } : {}),
      });
      window.location.assign(runHref(root, run.id));
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? (cause.code ?? "INTERNAL_ERROR")
          : "INTERNAL_ERROR",
      );
      setBusy(false);
    }
  }
  return (
    <dialog
      className="ui-confirm-dialog chapter-start"
      ref={dialog}
      aria-labelledby="overview-start-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <form onSubmit={submit}>
        <h2 id="overview-start-title">{c.newChapter}</h2>
        <label>
          {c.chapterNumber}
          <input
            type="number"
            name="chapter"
            required
            min={1}
            max={9999}
            defaultValue={initial}
          />
        </label>
        {scenarios.length > 0 && (
          <label>
            {c.scenario}
            <select name="simulation">
              {scenarios.map((scene) => (
                <option key={scene} value={scene}>
                  {c.scenarios[scene as keyof typeof c.scenarios] ??
                    c.unknownStatus}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <div className="chapter-problem" role="alert">
            <p>
              {error === "FAILED_PRECONDITION"
                ? c.notReady
                : error === "INSUFFICIENT_CREDITS"
                  ? c.insufficient
                  : (errorCopy[error as keyof typeof errorCopy] ??
                    errorCopy.INTERNAL_ERROR)}
            </p>
            {error === "FAILED_PRECONDITION" && (
              <a href={`${root}/ideation?compile=1`}>
                {overviewCopy.actions.compile}
              </a>
            )}
            {error === "INSUFFICIENT_CREDITS" && (
              <a href="/account">{c.account}</a>
            )}
          </div>
        )}
        <div className="ui-dialog-actions">
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            disabled={busy}
            onClick={close}
          >
            {c.close}
          </button>
          <button
            type="submit"
            className="ui-btn ui-btn-primary"
            disabled={busy || (!data && !settingsError)}
          >
            {busy ? c.starting : c.start}
          </button>
        </div>
      </form>
    </dialog>
  );
}

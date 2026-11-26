"use client";
import {
  type FormEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { shelfCopy as copy } from "../copy/zh-CN.ts";
import { Button } from "../ui/Button.tsx";
import { BookCover } from "./BookCover.tsx";
import { ApiError, post, request } from "./client.ts";
import { SafeMarkdown } from "./SafeMarkdown.tsx";
import { useApi } from "./useApi.ts";

interface Project {
  id: string;
  title: string;
  pending: number;
  created_at: string;
}

function ShelfDialog({
  title,
  busy,
  onDismiss,
  children,
}: {
  title: ReactNode;
  busy: boolean;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);

  return (
    <dialog
      className="ui-confirm-dialog shelf-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDismiss();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}

function CreateProjectDialog({ onDismiss }: { onDismiss: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const { id } = await post<{ id: string }>("/api/projects", {
        title: values.get("title"),
        mode: values.get("mode"),
      });
      window.location.assign(`/projects/${id}`);
    } catch (error) {
      setError(
        error instanceof ApiError && error.message
          ? error.message
          : copy.createError,
      );
      setBusy(false);
    }
  }

  return (
    <ShelfDialog title={copy.create} busy={busy} onDismiss={onDismiss}>
      <form onSubmit={create}>
        <label htmlFor={titleId}>{copy.title}</label>
        <input
          id={titleId}
          name="title"
          required
          maxLength={100}
          placeholder={copy.titlePlaceholder}
          disabled={busy}
        />
        <fieldset className="shelf-modes" disabled={busy}>
          <legend>{copy.mode}</legend>
          <label>
            <input type="radio" name="mode" value="blank" defaultChecked />
            <span>
              <strong>{copy.blank}</strong>
              <span>{copy.blankDescription}</span>
            </span>
          </label>
          <label>
            <input type="radio" name="mode" value="demo" />
            <span>
              <strong>{copy.demo}</strong>
              <span>{copy.demoDescription}</span>
            </span>
          </label>
        </fieldset>
        {error && (
          <p className="shelf-dialog-error" role="alert">
            <SafeMarkdown plain inline content={error} />
          </p>
        )}
        <div className="ui-dialog-actions">
          <Button variant="ghost" disabled={busy} onClick={onDismiss}>
            {copy.cancel}
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? copy.creating : copy.submit}
          </Button>
        </div>
      </form>
    </ShelfDialog>
  );
}

export function Projects() {
  const { data, error: loadError } = useApi<Project[]>("/api/projects");
  const [query, setQuery] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [zip, setZip] = useState<{ name: string; error?: string }>();
  const uploadInput = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setZip({ name: file.name });
    try {
      const title = encodeURIComponent(file.name.replace(/\.zip$/i, ""));
      const { id } = await request<{ id: string }>(
        `/api/projects/import?title=${title}`,
        {
          method: "POST",
          body: file,
          headers: { "content-type": "application/zip" },
        },
      );
      window.location.assign(`/projects/${id}`);
    } catch (error) {
      const response = error instanceof ApiError ? error.details : undefined;
      const value =
        response && typeof response === "object" && "error" in response
          ? response.error
          : undefined;
      const message =
        typeof value === "string"
          ? value
          : value && typeof value === "object" && "message" in value
            ? value.message
            : undefined;
      setZip({
        name: file.name,
        error:
          typeof message === "string" && message.trim()
            ? message
            : copy.importError,
      });
    }
  }

  const search = query.trim().toLowerCase();
  const filtering = pendingOnly || Boolean(search);
  const projects = data?.toSorted(
    (first, second) =>
      Date.parse(second.created_at) - Date.parse(first.created_at),
  );
  const firstPending = projects?.find((project) => project.pending > 0);
  const visible = projects?.filter(
    (project) =>
      (!pendingOnly || project.pending > 0) &&
      project.title.toLowerCase().includes(search),
  );

  return (
    <main className="page-content shelf-page">
      <header className="page-heading shelf-heading">
        <h1>{copy.heading}</h1>
        <div className="shelf-tools">
          <input
            type="search"
            aria-label={copy.search}
            placeholder={copy.search}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Button disabled={!data} onClick={() => uploadInput.current?.click()}>
            {copy.importZip}
          </Button>
          <Button
            variant="primary"
            disabled={!data}
            onClick={() => setCreating(true)}
          >
            {copy.create}
          </Button>
        </div>
      </header>

      {loadError && (
        <div role="alert" className="error">
          <SafeMarkdown plain content={loadError} />
        </div>
      )}
      {!data && !loadError && <output>{copy.loading}</output>}

      {firstPending && (
        <section className="shelf-pending">
          <BookCover id={firstPending.id} title={firstPending.title} />
          <div>
            <p className="shelf-pending-label">{copy.awaiting}</p>
            <h2>
              <SafeMarkdown plain inline content={firstPending.title} />
            </h2>
            <p>{copy.pendingSummary(firstPending.pending)}</p>
          </div>
          <a
            className="ui-btn ui-btn-primary"
            href={`/projects/${firstPending.id}`}
          >
            {copy.process}
          </a>
        </section>
      )}

      {data && (
        <div className="shelf-filter-bar">
          <fieldset className="shelf-filters" aria-label={copy.filters}>
            <button
              type="button"
              aria-pressed={!pendingOnly}
              onClick={() => setPendingOnly(false)}
            >
              {copy.all}
            </button>
            <button
              type="button"
              aria-pressed={pendingOnly}
              onClick={() => setPendingOnly(true)}
            >
              {copy.pendingOnly}
            </button>
          </fieldset>
          <span>{copy.order}</span>
        </div>
      )}

      {visible?.length === 0 && filtering && (
        <output className="shelf-no-results">{copy.noResults}</output>
      )}
      {data?.length === 0 && !filtering && (
        <section className="shelf-empty">
          <div className="shelf-add-cover" aria-hidden="true">
            {copy.plus}
          </div>
          <div>
            <h2>{copy.emptyTitle}</h2>
            <p>{copy.emptyDescription}</p>
            <div className="shelf-tools">
              <Button variant="primary" onClick={() => setCreating(true)}>
                {copy.create}
              </Button>
              <Button onClick={() => uploadInput.current?.click()}>
                {copy.importZip}
              </Button>
            </div>
          </div>
        </section>
      )}
      {visible && visible.length > 0 && (
        <ul className="shelf-grid" aria-label={copy.heading}>
          {visible.map((project) => (
            <li key={project.id}>
              <a className="shelf-book" href={`/projects/${project.id}`}>
                <div className="shelf-book-cover">
                  <BookCover id={project.id} title={project.title} />
                  {project.pending > 0 && (
                    <span className="shelf-badge" aria-hidden="true">
                      {project.pending}
                    </span>
                  )}
                </div>
                <span className="shelf-book-title">
                  <SafeMarkdown plain inline content={project.title} />
                </span>
                {project.pending > 0 ? (
                  <span className="shelf-book-status">
                    {copy.pendingCount(project.pending)}
                  </span>
                ) : (
                  <time dateTime={project.created_at}>
                    {copy.created(project.created_at.slice(0, 10))}
                  </time>
                )}
              </a>
            </li>
          ))}
          {!filtering && (
            <li>
              <button
                className="shelf-book shelf-add"
                type="button"
                onClick={() => setCreating(true)}
              >
                <span className="shelf-add-cover" aria-hidden="true">
                  {copy.plus}
                </span>
                <span className="shelf-book-title">{copy.create}</span>
                <span>{copy.createOptions}</span>
              </button>
            </li>
          )}
        </ul>
      )}

      {creating && <CreateProjectDialog onDismiss={() => setCreating(false)} />}
      {zip && (
        <ShelfDialog
          title={
            zip.error ? (
              copy.importFailed
            ) : (
              <>
                {copy.importOpening}
                <SafeMarkdown plain inline content={zip.name} />
                {copy.importClosing}
              </>
            )
          }
          busy={!zip.error}
          onDismiss={() => setZip(undefined)}
        >
          {zip.error ? (
            <>
              <p className="shelf-dialog-error" role="alert">
                <SafeMarkdown plain inline content={zip.error} />
              </p>
              <div className="ui-dialog-actions">
                <Button variant="ghost" onClick={() => setZip(undefined)}>
                  {copy.close}
                </Button>
                <Button
                  variant="primary"
                  onClick={() => uploadInput.current?.click()}
                >
                  {copy.chooseAgain}
                </Button>
              </div>
            </>
          ) : (
            <progress
              className="shelf-upload-progress"
              aria-label={copy.importProgress}
            />
          )}
        </ShelfDialog>
      )}
      <input
        ref={uploadInput}
        type="file"
        hidden
        accept=".zip,application/zip"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void upload(file);
        }}
      />
    </main>
  );
}

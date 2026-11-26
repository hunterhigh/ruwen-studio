"use client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { uiCopy } from "../copy/zh-CN.ts";
import { Button } from "./Button.tsx";

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel?: string;
  tone?: "danger" | "normal";
}
export interface ConfirmDialogProps extends ConfirmOptions {
  children?: ReactNode;
  onConfirm: () => void;
  onCancel?: () => void;
}
export function ConfirmDialog({
  title,
  body,
  confirmLabel = uiCopy.confirm,
  tone = "normal",
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const close = () => {
    dialog.current?.close();
    onCancel?.();
  };
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.showModal();
    cancel.current?.focus();
    return () => {
      if (element.open) element.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`ui-confirm-dialog ui-confirm-${tone}`}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          dialog.current?.close();
          onConfirm();
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <p id={bodyId}>{body}</p>
        {children}
        <div className="ui-dialog-actions">
          <button
            ref={cancel}
            type="button"
            className="ui-btn ui-btn-ghost"
            onClick={close}
          >
            {uiCopy.cancel}
          </button>
          <Button type="submit" variant="primary">
            {confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;
type Request = {
  id: number;
  options: ConfirmOptions;
  resolve: (result: boolean) => void;
};
const ConfirmContext = createContext<Ask | null>(null);
const denyWithoutProvider: Ask = async () => false;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const active = useRef<Request | null>(null);
  const queue = useRef<Request[]>([]);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const [request, setRequest] = useState<Request | null>(null);
  const ask = useCallback<Ask>(
    (options) =>
      new Promise((resolve) => {
        if (!mounted.current) {
          resolve(false);
          return;
        }
        const next = { id: ++sequence.current, options, resolve };
        if (active.current) queue.current.push(next);
        else {
          active.current = next;
          setRequest(next);
        }
      }),
    [],
  );
  const finish = useCallback((id: number, result: boolean) => {
    if (active.current?.id !== id) return;
    active.current.resolve(result);
    active.current = queue.current.shift() ?? null;
    setRequest(active.current);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.resolve(false);
      for (const waiting of queue.current) waiting.resolve(false);
      active.current = null;
      queue.current = [];
    };
  }, []);
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request && (
        <ConfirmDialog
          key={request.id}
          {...request.options}
          onConfirm={() => finish(request.id, true)}
          onCancel={() => finish(request.id, false)}
        />
      )}
    </ConfirmContext.Provider>
  );
}
/** A missing provider fails closed; rendering a shared component alone remains safe. */
export function useConfirm(): Ask {
  return useContext(ConfirmContext) ?? denyWithoutProvider;
}

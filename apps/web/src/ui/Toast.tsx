"use client";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export function Toast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  const [content, setContent] = useState<string | null>(message);
  useEffect(() => {
    setContent(message);
    const timer = setTimeout(() => {
      setContent(null);
      onDismiss?.();
    }, 2200);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  return content !== null ? (
    <output className="ui-toast" aria-live="polite">
      {content}
    </output>
  ) : null;
}
const ToastContext = createContext<(message: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const sequence = useRef(0);
  const [notice, setNotice] = useState<{ id: number; message: string } | null>(
    null,
  );
  const show = useCallback(
    (message: string) => setNotice({ id: ++sequence.current, message }),
    [],
  );
  const dismiss = useCallback(() => setNotice(null), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {notice && (
        <Toast key={notice.id} message={notice.message} onDismiss={dismiss} />
      )}
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

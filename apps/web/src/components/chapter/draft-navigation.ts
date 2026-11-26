"use client";
import { createContext, type RefObject, useContext, useEffect } from "react";

type ConfirmLeave = () => Promise<boolean>;
export const DraftLeaveContext =
  createContext<RefObject<ConfirmLeave | null> | null>(null);

export function useDraftLeave(dirty: boolean, leave: ConfirmLeave) {
  const guard = useContext(DraftLeaveContext);
  useEffect(() => {
    if (guard) guard.current = leave;
    return () => {
      if (guard?.current === leave) guard.current = null;
    };
  }, [guard, leave]);
  useEffect(() => {
    if (!dirty) return;
    let leaving = false;
    function beforeUnload(event: BeforeUnloadEvent) {
      if (leaving) return;
      event.preventDefault();
      event.returnValue = true;
    }
    function link(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      )
        return;
      const anchor = event.target.closest("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        (anchor.target && anchor.target !== "_self") ||
        anchor.hasAttribute("download")
      )
        return;
      const url = new URL(anchor.href);
      const current = window.location;
      if (
        !["http:", "https:"].includes(url.protocol) ||
        (url.origin === current.origin &&
          (url.pathname.startsWith("/api/") ||
            (url.hash &&
              url.pathname === current.pathname &&
              url.search === current.search)))
      )
        return;
      event.preventDefault();
      if (leaving) return;
      void leave().then((allowed) => {
        if (!allowed) return;
        leaving = true;
        window.location.assign(url.href);
      });
    }
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", link, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", link, true);
    };
  }, [dirty, leave]);
}

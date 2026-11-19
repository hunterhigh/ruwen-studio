"use client";
import { useEffect, useState } from "react";
import { frameCopy } from "../copy/zh-CN.ts";
import { request } from "./client.ts";

const storageKey = "ruwen:preview-banner-dismissed";
export function PreviewBanner({ enabled }: { enabled: boolean }) {
  const [dismissed, setDismissed] = useState(false);
  const [mode, setMode] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    try {
      setDismissed(sessionStorage.getItem(storageKey) === "1");
    } catch {
      // Storage is optional; the banner and its close button still work.
    }
    void request<{ mode: string }>("/api/settings")
      .then((settings) => {
        if (active) setMode(settings.mode);
      })
      .catch(() => {
        // Unknown mode must not claim that a real run is simulated.
      });
    return () => {
      active = false;
    };
  }, [enabled]);
  if (!enabled || dismissed) return null;
  return (
    <aside className="preview-banner" aria-label={frameCopy.previewLabel}>
      <span>{mode === "faux" ? frameCopy.previewFaux : frameCopy.preview}</span>
      <button
        type="button"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem(storageKey, "1");
          } catch {
            // A blocked session store must never block dismissing the banner.
          }
        }}
      >
        {frameCopy.dismissPreview}
      </button>
    </aside>
  );
}

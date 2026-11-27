"use client";
import type { ReactNode } from "react";
import { statusCopy as c } from "../copy/zh-CN.ts";
import { Button } from "./Button.tsx";
import { cleanErrorText } from "./error-text.ts";

export function InlineNotice({
  message,
  id,
  action,
  onAction,
  actionLabel = c.retry,
}: {
  message: string;
  id?: string;
  action?: ReactNode;
  onAction?: (() => void) | undefined;
  actionLabel?: string;
}) {
  return (
    <div className="ui-inline-notice" data-testid="inline-notice">
      <p id={id} role="alert">
        {cleanErrorText(message)}
      </p>
      {action ??
        (onAction && (
          <Button variant="ghost" onClick={onAction}>
            {actionLabel}
          </Button>
        ))}
    </div>
  );
}

import type { ReactNode } from "react";
import type { StatusTone } from "../copy/zh-CN.ts";

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone;
  children?: ReactNode;
}) {
  return <span className={`ui-status ui-status-${tone}`}>{children}</span>;
}

"use client";
import type { ButtonHTMLAttributes } from "react";
import { uiCopy } from "../copy/zh-CN.ts";

export function SealButton({
  children,
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`ui-seal-btn ${className}`} {...props}>
      <span className="ui-seal-glyph" aria-hidden="true">
        {uiCopy.sealGlyph}
      </span>
      <span>{children}</span>
    </button>
  );
}

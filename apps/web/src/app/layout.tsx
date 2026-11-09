import type { ReactNode } from "react";
export const metadata = {
  title: { default: "如文工作室", template: "%s · 如文" },
  description: "从构思到候选稿，每一步由你确认。",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/studio.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}

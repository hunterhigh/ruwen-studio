import type { ReactNode } from "react";
import { uiCopy } from "../copy/zh-CN.ts";
import { ConfirmProvider } from "../ui/ConfirmDialog.tsx";
import { ToastProvider } from "../ui/Toast.tsx";
export const metadata = {
  title: {
    default: uiCopy.metadata.title,
    template: uiCopy.metadata.titleTemplate,
  },
  description: uiCopy.metadata.description,
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="stylesheet" href="/fonts/ruwen-serif/font.css" />
        <link rel="stylesheet" href="/studio.css" />
      </head>
      <body>
        <ConfirmProvider>
          <ToastProvider>{children}</ToastProvider>
        </ConfirmProvider>
      </body>
    </html>
  );
}

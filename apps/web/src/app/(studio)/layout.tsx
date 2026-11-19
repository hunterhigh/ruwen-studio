import type { ReactNode } from "react";
import { Shell } from "../../components/Shell.tsx";
import { pageUser } from "../../server/page-auth.ts";
export const dynamic = "force-dynamic";
export default async function StudioLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { services, user } = await pageUser();
  return (
    <Shell
      user={user}
      admin={services.adminEmails.includes(user.email.toLowerCase())}
      previewBanner={
        process.env.NEXT_PUBLIC_RUWEN_PREVIEW_BANNER === "1" ||
        (process.env.NEXT_PUBLIC_RUWEN_PREVIEW_BANNER === undefined &&
          process.env.NODE_ENV === "development")
      }
    >
      {children}
    </Shell>
  );
}

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
    >
      {children}
    </Shell>
  );
}

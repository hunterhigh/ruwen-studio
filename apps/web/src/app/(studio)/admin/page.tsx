import { headers } from "next/headers.js";
import { notFound, redirect } from "next/navigation.js";
import { Admin } from "../../../components/Admin.tsx";
import { adminAllowed, auditAdmin } from "../../../server/admin-review.ts";
import { getServices } from "../../../server/services.ts";
export default async function AdminPage() {
  const services = await getServices();
  const session = await services.auth.api.getSession({
    headers: await headers(),
  });
  const allowed = Boolean(
    session && adminAllowed(services.adminEmails, session.user.email),
  );
  await auditAdmin(
    services.worker.db.pool,
    session?.user.id ?? null,
    "dashboard_page",
    allowed,
  );
  if (!session) redirect("/sign-in");
  if (!allowed) notFound();
  return <Admin />;
}

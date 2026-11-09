import { notFound } from "next/navigation.js";
import { Admin } from "../../../components/Admin.tsx";
import { pageUser } from "../../../server/page-auth.ts";
export default async function AdminPage() {
  const { user, services } = await pageUser();
  if (!services.adminEmails.includes(user.email.toLowerCase())) notFound();
  return <Admin />;
}

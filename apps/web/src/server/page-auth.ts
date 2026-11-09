import { headers } from "next/headers.js";
import { notFound, redirect } from "next/navigation.js";
import { type Resource, requireOwnership } from "./ownership.ts";
import { getServices } from "./services.ts";
export async function pageUser() {
  const services = await getServices(),
    session = await services.auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  return { services, user: session.user };
}
export async function ownedPage(resource: Resource) {
  const { services, user } = await pageUser();
  try {
    return {
      services,
      user,
      ...(await requireOwnership(services.worker.db, user.id, resource)),
    };
  } catch {
    notFound();
  }
}

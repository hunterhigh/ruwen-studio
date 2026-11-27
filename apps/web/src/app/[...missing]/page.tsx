import { notFound } from "next/navigation.js";

// Render the existing 404 with the current request's CSP nonce.
export const dynamic = "force-dynamic";

export default function MissingPage() {
  notFound();
}

import { notFound } from "next/navigation.js";
import { UiPreview } from "../../../components/dev/UiPreview.tsx";
export const dynamic = "force-dynamic";
export default function UiPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <UiPreview />;
}

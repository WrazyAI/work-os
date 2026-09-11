import { notFound } from "next/navigation";
import WorkOsPreviewClient from "./preview-client";

// Dev-only rendered-QA fixture (design.md §32.2). The proxy also blocks the
// path outside development; this guard covers authenticated production users.
export default function WorkOsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <WorkOsPreviewClient />;
}

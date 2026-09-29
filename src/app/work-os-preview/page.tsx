import { Suspense } from "react";
import { notFound } from "next/navigation";
import WorkOsPreviewClient from "./preview-client";

// Dev-only rendered-QA fixture (design §15). The proxy also blocks the path
// outside development; this guard covers authenticated production users.
export default function WorkOsPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Suspense fallback={null}>
      <WorkOsPreviewClient />
    </Suspense>
  );
}

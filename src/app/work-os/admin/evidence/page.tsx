import { Suspense } from "react";
import AdminEvidencePage from "@/modules/work-os/admin/AdminEvidence";

export default function AdminEvidenceRoute() {
  return (
    <Suspense fallback={null}>
      <AdminEvidencePage />
    </Suspense>
  );
}

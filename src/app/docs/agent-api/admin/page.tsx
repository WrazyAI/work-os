import type { Metadata } from "next";
import { ADMIN_AGENT_API_GUIDE_URL } from "@/modules/work-os/agent-api-docs";
import AdminApiDocs from "@/modules/work-os/admin-agent-docs/AdminApiDocs";
import GuideSwitch from "@/modules/work-os/admin-agent-docs/GuideSwitch";

export const metadata: Metadata = {
  title: "Administrator Agent API guide",
  description: "Connect an agent to Work OS Administration with organization-scoped reads and explicit confirmation for consequential changes.",
  robots: { index: true, follow: true },
  alternates: { canonical: ADMIN_AGENT_API_GUIDE_URL },
};

export default function AdminAgentApiDocsPage() {
  return (
    <>
      <GuideSwitch current="admin" />
      <AdminApiDocs />
    </>
  );
}

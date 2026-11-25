import type { Metadata } from "next";
import { AGENT_API_GUIDE_URL } from "@/modules/work-os/agent-api-docs";
import GuideSwitch from "@/modules/work-os/admin-agent-docs/GuideSwitch";
import ApiDocs from "@/modules/work-os/employee/ApiDocs";

export const metadata: Metadata = {
  title: "Employee Agent API guide",
  description: "Authenticate and use the personal Work OS Agent API over REST and MCP.",
  robots: { index: true, follow: true },
  alternates: { canonical: AGENT_API_GUIDE_URL },
};

export default function EmployeeAgentApiDocsPage() {
  return (
    <>
      <GuideSwitch current="user" />
      <ApiDocs />
    </>
  );
}

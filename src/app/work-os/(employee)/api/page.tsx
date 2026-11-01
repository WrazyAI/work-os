import type { Metadata } from "next";
import ApiDocs from "@/modules/work-os/employee/ApiDocs";

export const metadata: Metadata = {
  title: "Agent API",
  description: "Authenticate, call, and troubleshoot the Work OS Agent API.",
};

export default function AgentApiDocsPage() {
  return <ApiDocs />;
}

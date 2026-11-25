import type { Metadata } from "next";
import Link from "next/link";
import { AGENT_API_GUIDE_PATH, ADMIN_AGENT_API_GUIDE_PATH } from "@/modules/work-os/agent-api-docs";
import styles from "@/modules/work-os/admin-agent-docs/GuideNavigation.module.css";

export const metadata: Metadata = {
  title: "Agent API",
  description: "Choose the Work OS Agent API guide for employee or administrator tokens.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://app.wrazyos.com/docs/agent-api" },
};

export default function AgentApiDocsPage() {
  return (
    <div className={styles.chooser}>
      <h1>Work OS Agent API</h1>
      <p>Choose the guide that matches your token. The employee and administrator APIs use different tokens and endpoints.</p>
      <nav aria-label="Agent API guides">
        <ul>
          <li>
            <Link href={AGENT_API_GUIDE_PATH}>Employee guide</Link>
            <p>Use a <code>wos_agent_</code> token to work with tasks assigned to one person.</p>
          </li>
          <li>
            <Link href={ADMIN_AGENT_API_GUIDE_PATH}>Administrator guide</Link>
            <p>Use a <code>wos_admin_</code> token to read across your organization and preview changes for approval.</p>
          </li>
        </ul>
      </nav>
    </div>
  );
}

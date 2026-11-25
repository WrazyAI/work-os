import Link from "next/link";
import { AGENT_API_GUIDE_PATH, ADMIN_AGENT_API_GUIDE_PATH } from "@/modules/work-os/agent-api-docs";
import styles from "./GuideNavigation.module.css";

export default function GuideSwitch({ current }: { current: "user" | "admin" }) {
  return (
    <nav className={styles.switch} aria-label="Agent API guides">
      <Link href={AGENT_API_GUIDE_PATH} aria-current={current === "user" ? "page" : undefined}>Employee guide</Link>
      <Link href={ADMIN_AGENT_API_GUIDE_PATH} aria-current={current === "admin" ? "page" : undefined}>Administrator guide</Link>
    </nav>
  );
}

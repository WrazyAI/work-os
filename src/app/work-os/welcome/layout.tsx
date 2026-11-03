import type { Metadata } from "next";
import type { ReactNode } from "react";
import styles from "@/modules/work-os/marketing/site.module.css";

export const metadata: Metadata = {
  title: "Work OS — a clearer workday",
  description: "The Work OS desktop companion, end-of-day reports, and short employee tutorials.",
  robots: { index: false, follow: false },
};

export default function WelcomeLayout({ children }: { children: ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}

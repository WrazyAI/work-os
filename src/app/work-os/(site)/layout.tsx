import type { Metadata } from "next";
import type { ReactNode } from "react";
import styles from "@/modules/work-os/marketing/site.module.css";

export const metadata: Metadata = {
  title: "Work OS — a clearer workday",
  description: "The Work OS desktop companion, end-of-day reports, and short employee tutorials.",
  robots: { index: false, follow: false },
};

/** The public Work OS site owns its own materials. It is intentionally not
 * wrapped by the WrazyOS dashboard shell (see src/components/Shell.tsx). */
export default function WorkOsSiteLayout({ children }: { children: ReactNode }) {
  return <div className={styles.shell} data-work-os-site>{children}</div>;
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import styles from "@/modules/work-os/marketing/site.module.css";

const siteUrl = "https://app.wrazyos.com";
const imageUrl = "/work-os/opengraph-image";
const siteDescription =
  "Meet Work OS by Wrazy: a desktop companion for planning your workday, tracking sessions, and wrapping up with clear end-of-day reports.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Work OS by Wrazy — a clearer workday",
  description: siteDescription,
  alternates: { canonical: "/work-os" },
  openGraph: {
    type: "website",
    siteName: "WrazyOS",
    title: "Work OS by Wrazy — a clearer workday",
    description: siteDescription,
    url: "/work-os",
    images: [{ url: imageUrl, width: 1200, height: 630, alt: "Work OS by Wrazy — a clearer workday" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Work OS by Wrazy — a clearer workday",
    description: siteDescription,
    images: [imageUrl],
  },
  robots: { index: false, follow: false },
};

/** The public Work OS site owns its own materials. It is intentionally not
 * wrapped by the WrazyOS dashboard shell (see src/components/Shell.tsx). */
export default function WorkOsSiteLayout({ children }: { children: ReactNode }) {
  return <div className={styles.shell} data-work-os-site>{children}</div>;
}

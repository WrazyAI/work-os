import type { Metadata } from "next";
import Link from "next/link";
import DownloadChooser from "@/modules/work-os/marketing/DownloadChooser";
import WarningMark from "@/modules/work-os/marketing/WarningMark";
import { SiteFooter, SiteHeader } from "@/modules/work-os/marketing/SiteChrome";
import styles from "@/modules/work-os/marketing/downloads.module.css";

const description = "Download the Work OS desktop companion for Windows or macOS. Keep your workday, plans and end-of-day updates together.";

export const metadata: Metadata = {
  title: "Download Work OS by Wrazy",
  description,
  alternates: { canonical: "/work-os/downloads" },
  openGraph: {
    title: "Download Work OS by Wrazy",
    description,
    url: "/work-os/downloads",
  },
  twitter: {
    title: "Download Work OS by Wrazy",
    description,
  },
  robots: { index: false, follow: false },
};

export default function DownloadsPage() {
  return (
    <>
      <SiteHeader current="/work-os/downloads" />
      <main id="main" className={styles.main}>
        <header className={styles.intro}>
          <h1>Get your <span className={styles.productName}>Work OS</span> companion.</h1>
          <p>Your workday, right on your desktop.</p>
        </header>
        <DownloadChooser />
        <aside className={styles.notice} aria-label="Installation warning">
          <WarningMark size={24} />
          <p><strong>Expect a security warning.</strong> This internal build is unsigned. Antivirus may pause or block installation. We’ll show the steps after you download.</p>
        </aside>
        <p className={styles.tutorial}>First time here? <Link href="/work-os/tutorials/getting-set-up">Watch the setup guide</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}

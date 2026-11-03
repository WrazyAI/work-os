import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/modules/work-os/marketing/SiteChrome";
import TutorialLibrary from "@/modules/work-os/marketing/TutorialLibrary";
import styles from "@/modules/work-os/marketing/tutorials.module.css";

export const metadata: Metadata = {
  title: "Work OS tutorials",
  description: "Short, task-specific walkthroughs of the Work OS desktop companion.",
  robots: { index: false, follow: false },
};

export default function TutorialsPage() {
  return (
    <>
      <SiteHeader current="/work-os/welcome/tutorials" />
      <main id="main" className={styles.main}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}><span aria-hidden="true" />The Work OS field guide</p>
          <h1>See it.<br />Do it. Back to work.</h1>
          <p>
            Short videos. One task at a time. Real controls, clear closeups, and no need to watch everything.
            Every film starts on the dashboard and shows the route.
          </p>
          <p className={styles.small}>
            The EOD draft is the first published film. The rest are in production and marked honestly.
          </p>
        </header>
        <TutorialLibrary />
      </main>
      <SiteFooter />
    </>
  );
}

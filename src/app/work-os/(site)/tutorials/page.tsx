import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/modules/work-os/marketing/SiteChrome";
import TutorialLibrary from "@/modules/work-os/marketing/TutorialLibrary";
import styles from "@/modules/work-os/marketing/tutorials.module.css";

export const metadata: Metadata = {
  title: "Work OS tutorials",
  description: "Task-specific walkthroughs and one extended look at the Work OS desktop companion.",
  robots: { index: false, follow: false },
};

export default function TutorialsPage() {
  return (
    <>
      <SiteHeader current="/work-os/tutorials" />
      <main id="main" className={styles.main}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}><span aria-hidden="true" />The Work OS field guide</p>
          <h1>See it.<br />Do it. Back to work.</h1>
          <p>
            Short videos. One task at a time. Real controls, clear closeups, and no need to watch everything.
            Each lesson starts where its work begins, and the extended Otto walkthrough moves through a whole day.
          </p>
          <p className={styles.small}>
            Eleven lessons: ten short films and one extended walkthrough. Every lesson is online now, and each page carries the written steps as well.
          </p>
        </header>
        <TutorialLibrary />
      </main>
      <SiteFooter />
    </>
  );
}

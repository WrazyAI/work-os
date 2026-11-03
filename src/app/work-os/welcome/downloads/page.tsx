import type { Metadata } from "next";
import DownloadChooser from "@/modules/work-os/marketing/DownloadChooser";
import { SiteFooter, SiteHeader } from "@/modules/work-os/marketing/SiteChrome";
import styles from "@/modules/work-os/marketing/downloads.module.css";

export const metadata: Metadata = {
  title: "Download Work OS",
  description: "Install the Work OS desktop companion for Windows or macOS.",
  robots: { index: false, follow: false },
};

export default function DownloadsPage() {
  return (
    <>
      <SiteHeader current="/work-os/welcome/downloads" />
      <main id="main" className={styles.main}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}><span aria-hidden="true" />Work OS on your desktop</p>
          <h1>A place on<br />your workday.</h1>
          <p>Get the companion for your computer, connect your Wrazy account, and keep your work in view.</p>
        </header>

        <DownloadChooser />

        <section className={styles.notes} aria-labelledby="install-notes">
          <h2 id="install-notes">Before you install</h2>
          <div className={styles.noteGrid}>
            <article>
              <h3>The build is unsigned.</h3>
              <p>
                Windows may show a SmartScreen warning: choose <strong>More info</strong>, then
                <strong> Run anyway</strong>. On macOS, open <strong>System Settings → Privacy &amp; Security</strong>
                and choose <strong>Open Anyway</strong> after verifying the checksum. Never disable Gatekeeper globally.
              </p>
            </article>
            <article>
              <h3>Antivirus may pause the download.</h3>
              <p>
                The installer is new to some scanners and can be held for around a minute. If an install
                fails, wait for the scan to finish and try once more before using the manual installer.
              </p>
            </article>
            <article>
              <h3>Verify what you downloaded.</h3>
              <p>
                Compare the file’s SHA-256 value with the published checksums. The installer is an internal,
                unsigned build, never a signed or SmartScreen-approved release.
              </p>
              <a href="/downloads/work-os/windows/checksums">Open SHA-256 checksums</a>
            </article>
            <article>
              <h3>After it installs.</h3>
              <p>
                Open Work OS, sign in through your browser, choose your workspace, and authorize the device.
                Your Wrazy membership is what unlocks the workspace, not the download.
              </p>
            </article>
          </div>
        </section>

        <section className={styles.next} aria-labelledby="first-day">
          <h2 id="first-day">New here? Start with a short tour.</h2>
          <p>
            The field guide shows the real desktop app, one task at a time. Begin with connecting your
            workspace, then learn the parts you need.
          </p>
          <a className={styles.secondary} href="/work-os/welcome/tutorials">Explore the tutorials</a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

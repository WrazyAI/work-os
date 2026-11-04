import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DOWNLOAD_GUIDES, downloadGuide, downloadHref } from "@/modules/work-os/marketing/download-guides";
import { SiteFooter, SiteHeader } from "@/modules/work-os/marketing/SiteChrome";
import WarningMark from "@/modules/work-os/marketing/WarningMark";
import styles from "@/modules/work-os/marketing/download-guide.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOWNLOAD_GUIDES.map((guide) => ({ platform: guide.platform }));
}

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }): Promise<Metadata> {
  const guide = downloadGuide((await params).platform);
  if (!guide) return { title: "Install guide not found" };
  return {
    title: `Install Work OS for ${guide.label}`,
    description: `Important security warnings and installation steps for the Work OS ${guide.label} companion.`,
    robots: { index: false, follow: false },
  };
}

export default async function DownloadGuidePage({ params }: { params: Promise<{ platform: string }> }) {
  const guide = downloadGuide((await params).platform);
  if (!guide) notFound();

  return (
    <>
      <SiteHeader current="/work-os/downloads" />
      <main id="main" className={styles.main}>
        <p className={styles.back}><Link href="/work-os/downloads">← All downloads</Link></p>
        <header className={styles.hero}>
          <h1>Thanks for downloading.</h1>
          <p>Installing on {guide.label}. No file yet? <a href={downloadHref(guide.platform)} download>Download again</a></p>
        </header>

        <section className={styles.warning} aria-labelledby="security-warning">
          <header className={styles.warningHead}>
            <WarningMark />
            <div><h2 id="security-warning">Read this before installing</h2><p>{guide.securityNote}</p></div>
          </header>
          <div className={styles.warningList}>
            {guide.warnings.map((warning) => (
              <article key={warning.title}>
                <h3>{warning.title}</h3>
                {warning.action ? <strong className={styles.promptAction}>{warning.action}</strong> : null}
                <p>{warning.body}</p>
              </article>
            ))}
          </div>
          <p className={styles.safety}><strong>{guide.safety}</strong></p>
        </section>

        <details className={styles.help}>
          <summary>Verify this download (SHA-256)</summary>
          <div>
            <p>Run this command in {guide.platform === "windows" ? "PowerShell" : "Terminal"}, then compare the result with the <a href={`/downloads/work-os/${guide.platform}/checksums`}>published checksums</a>. A match confirms the file, not that a malware alert is safe to ignore.</p>
            <p className={styles.fileName}>{guide.fileName}</p>
            <code>{guide.checksumCommand}</code>
            <p>If it differs, do not install. Ask your admin.</p>
          </div>
        </details>

        <section className={styles.install} aria-labelledby="install-steps">
          <h2 id="install-steps">Then install in three steps</h2>
          <ol className={styles.steps}>
            {guide.steps.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <details className={styles.help}>
          <summary>More help with security prompts</summary>
          <div>{guide.prompts.map((prompt) => (
            <article key={prompt.title}><h3>{prompt.title}</h3><p>{prompt.body}</p></article>
          ))}</div>
        </details>
        <p className={styles.after}>Ready to connect? <Link href="/work-os/tutorials/getting-set-up">Watch the setup guide</Link></p>
      </main>
      <SiteFooter />
    </>
  );
}

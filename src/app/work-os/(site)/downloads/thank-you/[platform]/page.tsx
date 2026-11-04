import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  DOWNLOAD_GUIDES,
  downloadGuide,
  downloadHref,
} from "@/modules/work-os/marketing/download-guides";
import { SiteFooter, SiteHeader } from "@/modules/work-os/marketing/SiteChrome";
import styles from "@/modules/work-os/marketing/download-guide.module.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOWNLOAD_GUIDES.map((guide) => ({ platform: guide.platform }));
}

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }): Promise<Metadata> {
  const guide = downloadGuide((await params).platform);
  if (!guide) return { title: "Install guide not found" };
  return {
    title: `Your ${guide.label} download has started — Work OS`,
    description: `Install the unsigned Work OS ${guide.label} build, including the exact security prompts and how to get through them.`,
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
          <div>
            <p className={styles.eyebrow}><span aria-hidden="true" />{guide.label} install guide</p>
            <h1>Your {guide.label} download<br />has started.</h1>
            <p className={styles.lede}>{guide.lede}</p>
            <div className={styles.actions}>
              <a className={styles.primaryAction} href={downloadHref(guide.platform)} download>Download again</a>
              <a className={styles.secondaryAction} href={`/downloads/work-os/${guide.platform}/checksums`}>Check the SHA-256</a>
            </div>
            <p className={styles.recovery}>No file in your Downloads folder? Use Download again. If it still does not arrive, the build may be temporarily unavailable.</p>
          </div>
          <aside className={styles.fact} aria-label="Download details">
            <p className={styles.factLabel}>{guide.fileLabel}</p>
            <p className={styles.fileName}>{guide.fileName}</p>
            <p className={styles.factNote}>Unsigned internal build. Your computer may call it uncommon or unknown. Keep this page open while you install.</p>
            <p className={styles.status}><span aria-hidden="true" />Download started</p>
          </aside>
        </header>

        <section className={styles.guide} aria-labelledby="install-steps">
          <header className={styles.guideHead}>
            <h2 id="install-steps">Install it in four steps</h2>
            <p>Follow the steps in order. If a security prompt appears, the matching explanation is right below them.</p>
          </header>
          <ol className={styles.steps}>
            {guide.steps.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber} aria-hidden="true">{index + 1}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.prompts} aria-labelledby="prompt-help">
          <h2 id="prompt-help">If your computer stops you</h2>
          <p>These are normal warnings for an internal build without a recognized publisher signature or Apple notarization. Match the message on your screen to the one below.</p>
          <div className={styles.promptList}>
            {guide.prompts.map((prompt) => (
              <article className={styles.prompt} key={prompt.title}>
                <h3>{prompt.title}</h3>
                <p>{prompt.body}</p>
              </article>
            ))}
          </div>
        </section>

        <details className={styles.checksumHelp}>
          <summary>How to compare the SHA-256</summary>
          <p>Open the checksum file, find <strong>{guide.fileName}</strong>, and compare the long value. It must match exactly. This step is optional, but it confirms the file arrived intact.</p>
          <code>{guide.checksumCommand}</code>
        </details>

        <section className={styles.after} aria-labelledby="after-install">
          <h2 id="after-install">After it opens</h2>
          <p>{guide.after}</p>
          <Link href="/work-os/tutorials/getting-set-up">Set up your companion</Link>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

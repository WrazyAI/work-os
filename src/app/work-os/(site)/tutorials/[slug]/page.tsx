import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { adjacentTutorials, tutorialBySlug, TUTORIALS } from "@/modules/work-os/tutorials";
import { SiteFooter, SiteHeader } from "@/modules/work-os/marketing/SiteChrome";
import TutorialPlayer from "@/modules/work-os/marketing/TutorialPlayer";
import styles from "@/modules/work-os/marketing/tutorials.module.css";

export function generateStaticParams() {
  return TUTORIALS.map((tutorial) => ({ slug: tutorial.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const tutorial = tutorialBySlug((await params).slug);
  if (!tutorial) return { title: "Tutorial not found" };
  return {
    title: `${tutorial.title} — Work OS`,
    description: tutorial.summary,
    robots: { index: false, follow: false },
  };
}

export default async function TutorialPage({ params }: { params: Promise<{ slug: string }> }) {
  const tutorial = tutorialBySlug((await params).slug);
  if (!tutorial) notFound();
  const published = tutorial.status === "published";
  const { previous, next } = adjacentTutorials(tutorial.slug);

  return (
    <>
      <SiteHeader current="/work-os/tutorials" />
      <main id="main" className={styles.lesson}>
        <p className={styles.back}><Link href="/work-os/tutorials">← All tutorials</Link></p>
        <header className={styles.lessonHead}>
          <p className={styles.eyebrow}><span aria-hidden="true" />{published ? "Desktop walkthrough" : "In production"}</p>
          <h1>{tutorial.title}</h1>
          <p>{tutorial.summary}</p>
        </header>

        {published ? (
          <TutorialPlayer tutorial={tutorial} />
        ) : (
          <div className={styles.pendingPanel} role="status">
            <strong>This film is in production.</strong>
            <p>The written steps below are ready now. The video will appear here once it is recorded and verified.</p>
          </div>
        )}

        <section className={styles.steps} aria-labelledby="steps-title">
          <h2 id="steps-title">The walkthrough</h2>
          <ol>
            {tutorial.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className={styles.platformNote}><strong>Platform note.</strong> {tutorial.platformNote}</p>
        </section>

        <p className={styles.provenance}>Actual desktop app · Demonstration data. Nothing here uses a live employee record.</p>

        <nav className={styles.lessonNav} aria-label="More tutorials">
          {previous ? (
            <Link
              className={styles.lessonLink}
              href={`/work-os/tutorials/${previous.slug}`}
              aria-label={`Previous tutorial: ${previous.title}`}
            >
              <span>Previous</span>
              <strong>{previous.title}</strong>
            </Link>
          ) : <span aria-hidden="true" />}
          {next ? (
            <Link
              className={`${styles.lessonLink} ${styles.next}`}
              href={`/work-os/tutorials/${next.slug}`}
              aria-label={`Next tutorial: ${next.title}`}
            >
              <span>Next</span>
              <strong>{next.title}</strong>
            </Link>
          ) : <span aria-hidden="true" />}
        </nav>
      </main>
      <SiteFooter />
    </>
  );
}

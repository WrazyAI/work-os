import Link from "next/link";
import ProductTheater from "./ProductTheater";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import styles from "./landing.module.css";

export default function LandingPage() {
  return (
    <div className={styles.page} data-landing>
      <SiteHeader current="/work-os" tone="dark" />
      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="welcome-title">
          <p className={styles.presence} data-hero-intro><span aria-hidden="true" />Made for your Wrazy workday.</p>
          <h1 id="welcome-title" className={styles.heroTitle}>
            <span><span data-hero-line>Good work.</span></span>
            <span><span data-hero-line>Good company.</span></span>
          </h1>
          <div className={styles.heroDetails} data-hero-details>
            <p className={styles.lede}>Meet the companion that keeps your plan, progress, and end of day in the same story.</p>
            <div>
              <div className={styles.actions}>
                <Link className={styles.primary} href="/work-os/downloads">Get Work OS <span aria-hidden="true">↓</span></Link>
                <a className={styles.plain} href="#your-workday">Meet your workday</a>
              </div>
              <p className={styles.small}>Windows &amp; macOS. Your existing Wrazy account.</p>
            </div>
          </div>
          <ProductTheater />
        </section>
        <div className={styles.bridge}>
          <p>Not another place to keep busy.<br />A place to see what matters.</p>
          <div><span>Your plan</span><span>Your context</span><span>Your final say</span></div>
        </div>
        <section className={styles.story} id="your-workday" aria-labelledby="story-title" data-workday-story>
          <h2 id="story-title" data-motion-reveal>A workday.<br />Not a pile<br />of loose ends.</h2>
          <p data-motion-reveal>The plan in your head. The tasks on your list. The progress between check ins.<br /><br />
            <strong>Work OS gives them a place together.</strong> And gives you the last word on the report.
          </p>
        </section>
        <section className={styles.steps} aria-label="How Work OS fits your day" data-workday-steps>
          <article data-motion-reveal><small>Start with intention</small><h3>Find your first move.</h3><p>Set a focus, shape a plan, and keep the work that needs you in sight.</p></article>
          <article data-motion-reveal><small>Keep the thread</small><h3>A little context matters.</h3><p>Read your activity recaps. Confirm what&apos;s right and add what only you know.</p></article>
          <article data-motion-reveal><small>End with the record</small><h3>Make it your report.</h3><p>Start from the day&apos;s work, review the draft, and submit when you&apos;re ready.</p></article>
        </section>
        <section className={styles.film} aria-labelledby="film-title" data-tutorial-feature data-motion-reveal>
          <div>
            <h2 id="film-title">See the clicks.<br />Get on with it.</h2>
            <p>Short lessons from the actual desktop app. Pick the workflow you need and get back to your day.</p>
            <Link className={styles.plain} href="/work-os/tutorials">Browse the tutorials</Link>
          </div>
          <Link className={styles.filmCard} href="/work-os/tutorials/eod-draft">
            <span className={styles.filmStill}>
              <img src="/site/work-os/tutorials/eod-draft.jpg" alt="Draft an EOD report tutorial with the Work OS companion" width={1440} height={900} loading="lazy" />
              <span className={styles.play} aria-hidden="true">▶</span>
            </span>
            <span className={styles.filmCaption}><strong>Draft an EOD report</strong><small>Actual desktop app · Demonstration data</small></span>
          </Link>
        </section>
        <section className={styles.closing} aria-labelledby="closing-title" data-landing-closing data-motion-reveal>
          <h2 id="closing-title">Good work deserves<br />a clearer day.</h2>
          <Link className={styles.primary} href="/work-os/downloads">Get Work OS <span aria-hidden="true">↓</span></Link>
        </section>
      </main>
      <SiteFooter tone="dark" />
    </div>
  );
}

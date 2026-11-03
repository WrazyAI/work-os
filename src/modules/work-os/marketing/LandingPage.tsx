import Link from "next/link";
import ProductTheater from "./ProductTheater";
import Companion from "./Companion";
import { SiteFooter, SiteHeader } from "./SiteChrome";
import styles from "./landing.module.css";

export default function LandingPage() {
  return (
    <>
      <SiteHeader current="/work-os/welcome" />
      <main id="main" className={styles.main}>
        <section className={styles.hero} aria-labelledby="welcome-title">
          <div className={styles.heroCopy}>
            <p className={styles.presence}><span aria-hidden="true" />Built for the Wrazy team</p>
            <h1 id="welcome-title">A little company.<br />A clearer workday.</h1>
            <p className={styles.lede}>
              Meet Work OS. Keep track of your day, see the work behind it, and turn your progress
              into a report, with your companion alongside you.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primary} href="/work-os/welcome/downloads">
                Get Work OS
                <span aria-hidden="true">↓</span>
              </Link>
              <Link className={styles.plain} href="/work-os/welcome/tutorials">
                See how it works
                <span aria-hidden="true">›</span>
              </Link>
            </div>
            <p className={styles.small}>For your Wrazy workspace. Your existing account.</p>
          </div>
          <div className={styles.companion}>
            <p className={styles.speech}>Your work has a story.<br />Let’s keep the pieces together.</p>
            <Companion />
          </div>
        </section>

        <section className={styles.showcase} aria-label="A look inside Work OS">
          <ProductTheater />
        </section>

        <section className={styles.steps} id="how-it-works" aria-labelledby="steps-title">
          <h2 id="steps-title" className={styles.srOnly}>How Work OS fits your day</h2>
          <article>
            <span className={styles.stepNumber}>1</span>
            <div>
              <h3>Start with a clear plan.</h3>
              <p>Connect your workspace, set your focus, and see what needs your attention.</p>
            </div>
          </article>
          <article>
            <span className={styles.stepNumber}>2</span>
            <div>
              <h3>Keep your work in view.</h3>
              <p>Follow your tasks, read activity recaps, and add the context only you know.</p>
            </div>
          </article>
          <article>
            <span className={styles.stepNumber}>3</span>
            <div>
              <h3>Close the day with the record.</h3>
              <p>Draft your EOD from the day’s work. Review it, make it yours, then submit.</p>
            </div>
          </article>
        </section>

        <section className={styles.film} aria-labelledby="film-title">
          <div className={styles.filmCopy}>
            <p className={styles.eyebrow}>The field guide</p>
            <h2 id="film-title">A short walkthrough.<br />For the thing you need.</h2>
            <p>
              No long tour to sit through. Pick a task, watch the real clicks, and get back to your day.
              Every film starts on the dashboard and shows the route.
            </p>
            <Link className={styles.primary} href="/work-os/welcome/tutorials">Browse tutorials</Link>
          </div>
          <Link className={styles.filmCard} href="/work-os/welcome/tutorials/eod-draft">
            <span className={styles.filmStill}>
              <img src="/site/work-os/tutorials/eod-draft.jpg" alt="EOD tutorial opening frame with the companion" width={1440} height={900} />
              <span className={styles.play} aria-hidden="true">▶</span>
            </span>
            <span className={styles.filmCaption}>
              <strong>Draft an EOD report</strong>
              <small>Actual desktop app · Demonstration data<br />60 fps · 25 seconds</small>
            </span>
          </Link>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <h2 id="closing-title">Less reconstructing.<br />More getting on<br />with your day.</h2>
          <div>
            <p>
              Your plan, work activity and end-of-day report belong together. Work OS gives you a
              place to see them, and a chance to add your side of the story.
            </p>
            <Link className={styles.dark} href="/work-os/welcome/downloads">Find your download</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}

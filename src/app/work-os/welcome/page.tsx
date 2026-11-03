import Link from "next/link";
import { WORK_OS_SITE } from "@/modules/work-os/marketing/site";
import styles from "@/modules/work-os/marketing/site.module.css";

export default function WelcomePage() {
  return (
    <>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link className={styles.brand} href="/work-os/welcome" aria-label="Work OS home">
          <span className={styles.mark} aria-hidden="true">w</span>
          <span>{WORK_OS_SITE.product}</span>
          <span className={styles.byline}>{WORK_OS_SITE.byline}</span>
        </Link>
        <nav className={styles.nav} aria-label="Work OS site">
          {WORK_OS_SITE.nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.href === "/work-os/welcome" ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
          <a className={styles.back} href={WORK_OS_SITE.wrazyos.href}>WrazyOS ↗</a>
        </nav>
      </header>
      <main className={styles.main} id="main">
        <h1>A little company. A clearer workday.</h1>
        <p>The employee site is being assembled here.</p>
      </main>
      <footer className={styles.footer}>
        <span>Work OS. Made for the Wrazy workday.</span>
        <div className={styles.footerLinks}>
          <a href="https://app.wrazyos.com/privacy">Privacy</a>
          <a href="https://app.wrazyos.com/terms">Terms</a>
          <a href={WORK_OS_SITE.wrazyos.href}>Back to WrazyOS ↗</a>
        </div>
      </footer>
    </>
  );
}

import Link from "next/link";
import { WORK_OS_SITE } from "./site";
import styles from "./site.module.css";

export function SiteHeader({ current }: { current: string }) {
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
            <Link key={item.href} href={item.href} aria-current={item.href === current ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
          <a className={styles.back} href={WORK_OS_SITE.wrazyos.href}>WrazyOS ↗</a>
        </nav>
      </header>
    </>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <span>Work OS. Made for the Wrazy workday.</span>
      <div className={styles.footerLinks}>
        <a href="https://app.wrazyos.com/privacy">Privacy</a>
        <a href="https://app.wrazyos.com/terms">Terms</a>
        <a href={WORK_OS_SITE.wrazyos.href}>Back to WrazyOS ↗</a>
      </div>
    </footer>
  );
}

import Link from "next/link";
import Image from "next/image";
import { WORK_OS_SITE } from "./site";
import styles from "./site.module.css";

export function SiteHeader({ current }: { current: string }) {
  return (
    <>
      <a className={styles.skip} href="#main">Skip to content</a>
      <header className={styles.header}>
        <Link className={styles.brand} href={WORK_OS_SITE.home}>
          <Image className={styles.mark} src="/site/work-os/work-os-mark.png" alt="" width={34} height={34} unoptimized />
          <span>{WORK_OS_SITE.product}</span>
          <span className={styles.byline}>{WORK_OS_SITE.byline}</span>
        </Link>
        <nav className={styles.nav} aria-label="Work OS site">
          {WORK_OS_SITE.nav.map((item) => (
            <Link key={item.href} href={item.href} aria-current={item.href === current ? "page" : undefined}>
              {item.label}
            </Link>
          ))}
          <a className={styles.workspace} href="/work-os/workspace">Open workspace</a>
          <Link className={styles.back} href={WORK_OS_SITE.wrazyos.href}>WrazyOS ↗</Link>
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
        <a href="/work-os/workspace">Open your workspace</a>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href={WORK_OS_SITE.wrazyos.href}>Back to WrazyOS ↗</Link>
      </div>
    </footer>
  );
}

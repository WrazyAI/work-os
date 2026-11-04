import Link from "next/link";
import { TUTORIALS } from "@/modules/work-os/tutorials";
import styles from "./tutorials.module.css";

export default function TutorialLibrary() {
  return (
    <div className={styles.grid}>
      {TUTORIALS.map((tutorial, index) => {
        const published = tutorial.status === "published";
        const inner = (
          <>
            <span className={styles.thumb}>
              {tutorial.poster ? (
                <img src={tutorial.poster} alt="" width={1440} height={900} />
              ) : (
                <span className={styles.placeholder} aria-hidden="true">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                </span>
              )}
              {published ? <span className={styles.play} aria-hidden="true">▶</span> : null}
            </span>
            <span className={styles.cardBody}>
              <span className={styles.cardMeta}>
                {published ? `Watch · ${tutorial.duration ? Math.round(tutorial.duration) : 25}s` : "In production"}
              </span>
              <strong>{tutorial.title}</strong>
              <span className={styles.cardSummary}>{tutorial.summary}</span>
              <span className={styles.platform}>{tutorial.platformNote}</span>
            </span>
          </>
        );
        return published ? (
          <Link key={tutorial.slug} className={styles.card} href={`/work-os/tutorials/${tutorial.slug}`}>
            {inner}
          </Link>
        ) : (
          <article key={tutorial.slug} className={`${styles.card} ${styles.pending}`} aria-disabled="true">
            {inner}
          </article>
        );
      })}
    </div>
  );
}

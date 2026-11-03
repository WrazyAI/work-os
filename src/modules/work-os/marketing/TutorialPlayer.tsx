"use client";

import type { Tutorial } from "@/modules/work-os/tutorials";
import styles from "./tutorials.module.css";

export default function TutorialPlayer({ tutorial }: { tutorial: Tutorial }) {
  if (!tutorial.video || !tutorial.poster || !tutorial.captions) return null;
  return (
    <figure className={styles.player}>
      <video
        controls
        playsInline
        preload="none"
        poster={tutorial.poster}
        aria-label={`${tutorial.title} walkthrough`}
      >
        <source src={tutorial.video} type="video/mp4" />
        <track kind="captions" src={tutorial.captions} srcLang="en" label="English" default />
        Your browser cannot play this film. The written walkthrough below covers every step.
      </video>
      <figcaption>
        <span>Actual desktop app · Demonstration data</span>
        <span>{tutorial.duration ? `${Math.round(tutorial.duration)} seconds · captions available` : "Captions available"}</span>
      </figcaption>
    </figure>
  );
}

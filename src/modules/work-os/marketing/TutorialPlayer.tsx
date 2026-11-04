"use client";

import { useRef } from "react";
import type { Tutorial } from "@/modules/work-os/tutorials";
import { seekTutorialChapter } from "@/modules/work-os/tutorial-chapters";
import styles from "./tutorials.module.css";

export default function TutorialPlayer({ tutorial }: { tutorial: Tutorial }) {
  const player = useRef<HTMLVideoElement>(null);
  if (!tutorial.video || !tutorial.poster || !tutorial.captions) return null;
  return (
    <figure className={styles.player}>
      <video
        ref={player}
        controls
        playsInline
        preload="none"
        poster={tutorial.poster}
        aria-label={`${tutorial.title} walkthrough`}
      >
        <source src={tutorial.video} type="video/mp4" />
        <track kind="captions" src={tutorial.captions} srcLang="en" label="English" />
        Your browser cannot play this film. The written walkthrough below covers every step.
      </video>
      <figcaption>
        <span>Actual desktop app · Demonstration data</span>
        <span>{tutorial.duration ? `${Math.round(tutorial.duration)} seconds · captions available` : "Captions available"}</span>
      </figcaption>
      {tutorial.chapters?.length ? (
        <nav className={styles.chapters} aria-label="Parts of this film">
          <ol>
            {tutorial.chapters.map((chapter, index) => (
              <li key={chapter.start}>
                <button type="button" onClick={() => {
                  if (!player.current) return;
                  seekTutorialChapter(player.current, chapter.start);
                  // A keyboard or screen-reader employee asked for this part;
                  // put the native player's own controls under their next key.
                  player.current.focus({ preventScroll: true });
                }}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{chapter.title}</strong>
                  <time>{Math.floor(chapter.start / 60)}:{String(Math.floor(chapter.start % 60)).padStart(2, "0")}</time>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
    </figure>
  );
}

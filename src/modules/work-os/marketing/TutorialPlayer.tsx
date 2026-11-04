"use client";

import { useRef, useState } from "react";
import type { Tutorial } from "@/modules/work-os/tutorials";
import { formatTutorialDuration } from "@/modules/work-os/tutorial-duration";
import { seekTutorialChapter } from "@/modules/work-os/tutorial-chapters";
import styles from "./tutorials.module.css";

export default function TutorialPlayer({ tutorial }: { tutorial: Tutorial }) {
  const player = useRef<HTMLVideoElement>(null);
  const [announcement, setAnnouncement] = useState("");
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
      {tutorial.chapters?.length ? (
        <nav className={styles.chapters} aria-label="Parts of this film">
          <ol>
            {tutorial.chapters.map((chapter, index) => (
              <li key={chapter.start}>
                <button type="button" onClick={() => {
                  if (!player.current) return;
                  seekTutorialChapter(player.current, chapter.start);
                  // Keyboard focus stays on the chosen part so the rest of the
                  // chapter list is one Tab away; the live region confirms the
                  // seek for screen readers without moving them to the video.
                  setAnnouncement(`Starting part ${String(index + 1).padStart(2, "0")}, ${chapter.title}.`);
                }}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{chapter.title}</strong>
                  <time>{formatTutorialDuration(chapter.start)}</time>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}
      <p className={styles.chapterStatus} aria-live="polite">{announcement}</p>
      <figcaption>
        <span>Actual desktop app · Demonstration data</span>
        <span>{formatTutorialDuration(tutorial.duration)} · captions available</span>
      </figcaption>
    </figure>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import type { GuideFilm as Film } from "./guideFilms";

/** Clip lengths are read off the encoded files, so they can exceed a minute. */
export const clockLabel = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/**
 * The film well inside a page guide.
 *
 * The guide used to hold a hand-drawn inline scene: an abstract diagram of the
 * page. A diagram can say what a page is for, but never where anything is — so
 * this plays footage of the real companion instead, and the numbered steps act
 * as chapters over it.
 *
 * A few decisions worth keeping:
 *
 *   - The poster is a separate `<img>`, not the video's own `poster` attribute.
 *     A video's poster is not painted until the element has metadata, which on a
 *     cold start is exactly the moment the employee is looking at an empty
 *     rectangle. A plain image paints on the first frame.
 *   - The clip is reset by key rather than by seeking. Seeking a source that is
 *     still loading is the flakiest thing a `<video>` does, and every clip is
 *     small enough that reloading it is cheap and always correct.
 *   - Under reduced motion nothing plays until the employee asks it to. The
 *     still frame and the step copy carry the whole meaning on their own, which
 *     is the standard every other surface in this app is held to.
 *   - The film is decorative to a screen reader. The steps beside it already
 *     state everything it shows, in words, and that is the accessible path.
 */
export default function GuideFilm({
  view,
  film,
  chapterKey,
  autoplay,
  onEnded,
}: {
  view: string;
  film: Film | null;
  /** Changes whenever the selected chapter changes, which restarts playback. */
  chapterKey: string;
  autoplay: boolean;
  onEnded: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setRevealed(true);
    void video.play().catch(() => undefined);
  }, []);

  // A new chapter restarts the clip. `key` on the element would remount it, but
  // remounting costs a decode of the poster each time; loading the source in
  // place is enough and keeps the still on screen throughout.
  useEffect(() => {
    const video = videoRef.current;
    setProgress(0);
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    if (autoplay) play();
    else setRevealed(false);
  }, [chapterKey, autoplay, play]);

  if (!film) {
    return (
      <div id="page-guide-art" className="guide-film is-missing" data-guide-view={view} role="presentation">
        <p>This guide's film is not installed on this device.</p>
      </div>
    );
  }

  return (
    <div id="page-guide-art" className="guide-film" data-guide-view={view} data-chapter={chapterKey} role="presentation">
      <img className="guide-film-still" src={film.poster} alt="" aria-hidden="true" draggable={false} />
      <video
        ref={videoRef}
        className={`guide-film-video${revealed ? " is-revealed" : ""}`}
        src={film.file}
        poster={film.poster}
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        tabIndex={-1}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          if (!video.duration) return;
          setProgress(Math.min(1, video.currentTime / video.duration));
        }}
        onPlaying={() => setRevealed(true)}
        onEnded={onEnded}
      />
      {!autoplay && !revealed ? (
        <button type="button" className="guide-film-play" onClick={play}>
          <Play size={15} aria-hidden="true" />
          Play this step
        </button>
      ) : null}
      <span className="guide-film-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${progress})` }} />
      </span>
    </div>
  );
}

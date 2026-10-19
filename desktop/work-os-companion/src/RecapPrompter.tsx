import { useEffect, useRef, useState, type CSSProperties } from "react";
import { prompterScroll, type RecapSpeechLine } from "./recapSpeech";

/**
 * The recap teleprompter: while Otto reads, the bubble's preview lines become a
 * window the words slide through, the line being spoken bright in the middle.
 *
 * The words are the server's own spoken lines (never assembled here), so what is
 * shown and what is said cannot drift. The motion is driven by the audio's
 * clock — `progress` — and never by a timer of its own, which is what makes the
 * last line land as the voice stops. Reduced motion keeps every meaning and
 * drops the slide: the rows stay put and the active one is announced once.
 */
export function RecapPrompter({
  lines,
  progress,
  activeIndex,
  reduced,
  className,
}: {
  lines: RecapSpeechLine[];
  /** 0–1 of the clip's duration. */
  progress: number;
  /** The line being spoken. */
  activeIndex: number;
  reduced: boolean;
  className?: string;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);

  // Measured, not assumed: a line may wrap on the narrow companion, and the
  // row being spoken has to sit in the window's clear middle whatever its
  // height — an earlier version centred by the row's top, which left a wrapped
  // active line half inside the fade and looking dimmed.
  useEffect(() => {
    const element = track.current;
    if (!element || reduced) return;
    const rows = element.children;
    const active = rows.item(Math.min(activeIndex, rows.length - 1)) as HTMLElement | null;
    if (!active) return;
    const window = element.parentElement;
    const windowHeight = window?.clientHeight ?? 0;
    // A small travel inside the row keeps the motion continuous rather than
    // stepping: the same weighted fraction the highlight uses.
    const within = Math.max(0, Math.min(1, progress * lines.length - activeIndex));
    const centred = active.offsetTop - Math.max(0, (windowHeight - active.offsetHeight) / 2);
    setOffset(Math.max(0, centred + within * active.offsetHeight * 0.4));
  }, [activeIndex, progress, lines.length, reduced]);

  if (!lines.length) return null;

  return <div
    className={`recap-prompter${className ? ` ${className}` : ""}`}
    data-reduced={reduced ? "true" : "false"}
    data-progress={progress.toFixed(3)}
  >
    <div className="recap-prompter-window" aria-hidden={reduced ? "true" : undefined}>
      <div
        className="recap-prompter-track"
        ref={track}
        style={reduced ? undefined : { transform: `translateY(-${Math.round(offset)}px)` } as CSSProperties}
      >
        {lines.map((line, index) => <p
          key={`${index}-${line.text.slice(0, 24)}`}
          className="recap-prompter-line"
          data-active={index === activeIndex ? "true" : "false"}
        >
          {line.time && <time>{line.time}</time>}
          {line.text}
        </p>)}
      </div>
    </div>
    {reduced && <p className="sr-only" role="status" aria-live="polite">{lines[Math.min(activeIndex, lines.length - 1)]?.text}</p>}
    <span className="recap-prompter-progress" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} /></span>
  </div>;
}

/** How far the track would travel at this point, for tests and previews. */
export function prompterOffsetFraction(lines: number, progress: number): number {
  return prompterScroll(progress, Array.from({ length: lines }, () => 1));
}

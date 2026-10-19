import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * One clipped line that pans to its end while hovered.
 *
 * The measure is the overflow itself rather than the text length, so the pan
 * always stops with the last character at the clip edge. Zero means the line
 * fits: no class is added, so nothing fades and nothing can move.
 *
 * Every clipped line travels at one constant rate, PAN_PX_PER_SECOND. The old
 * formula had a 2.6s floor and a 7s cap, which made a 20px clip crawl at
 * 7.7px/s while a 1,200px clip dashed at 171px/s. Measured overflows in the
 * running companion run from 4px to 496px for ordinary task rows (median
 * 102px, p90 314px, max 496px) and 28–119px for ordinary focus lines; at
 * 100px/s those reveal in about 1s, 3.1s, and 5s. The rate is 2.2× the old
 * ~45px/s nominal and sits above the 90px/s point where a constant rate first
 * stops being slower than the old timing at any length. It keeps the old 7s
 * ceiling only as a residual bound: it engages past PAN_MAX_OVERFLOW_PX
 * (700px), beyond every measured ordinary line, so a pathological statement
 * still finishes in 7s instead of running for a minute.
 *
 * The caller supplies the typography (`className` on the clip box,
 * `lineClassName` on the moving line); this owns the behaviour, so the focus
 * statements and the chat task titles cannot drift apart.
 *
 * The transition lives only in the `:hover` rule (see dashboard-overhaul.css),
 * which is what makes leaving snap straight back instead of animating. A
 * ResizeObserver re-measures when the copy, the text scale, or the window
 * changes, because a line can start or stop overflowing without a re-render.
 */
export const PAN_PX_PER_SECOND = 100;
export const PAN_MAX_MS = 7000;
export const PAN_MAX_OVERFLOW_PX = (PAN_PX_PER_SECOND * PAN_MAX_MS) / 1000;

/** The measured duration for a clip, in milliseconds. Zero when nothing is
 * clipped. Past the residual bound, duration stays at the 7s ceiling, so the
 * effective rate rises there by design rather than the line running longer. */
export function panDurationMs(overflow: number) {
  if (overflow <= 0) return 0;
  return Math.min(PAN_MAX_MS, Math.round((overflow / PAN_PX_PER_SECOND) * 1000));
}
export function OverflowPanText({ children, className, lineClassName }: { children: ReactNode; className?: string; lineClassName?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setOverflow(Math.max(0, el.scrollWidth - el.clientWidth));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);
  // One constant rate for every line, with the documented 7s residual bound.
  // The CSS owns the easing and the instant return.
  const panMs = panDurationMs(overflow);
  return (
    <span
      ref={ref}
      className={`overflow-pan${overflow > 0 ? " is-overflowing" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--focus-shift": `${-overflow}px`, "--focus-pan-duration": `${panMs}ms` } as CSSProperties}
    >
      <span className={`overflow-pan-line${lineClassName ? ` ${lineClassName}` : ""}`}>{children}</span>
    </span>
  );
}

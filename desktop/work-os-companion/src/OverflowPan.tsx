import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/**
 * One clipped line that pans to its end while hovered.
 *
 * The measure is the overflow itself rather than the text length, so the pan
 * always stops with the last character at the clip edge. Zero means the line
 * fits: no class is added, so nothing fades and nothing can move.
 *
 * The transition lives only in the `:hover` rule (see dashboard-overhaul.css),
 * which is what makes leaving snap straight back instead of animating. A
 * ResizeObserver re-measures when the copy, the text scale, or the window
 * changes, because a line can start or stop overflowing without a re-render.
 */
export function OverflowPanText({ children, className }: { children: ReactNode; className?: string }) {
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
  return (
    <span
      ref={ref}
      className={`agenda-strip-focus-scroll${overflow > 0 ? " is-overflowing" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--focus-shift": `${-overflow}px` } as CSSProperties}
    >
      <span className="agenda-strip-text">{children}</span>
    </span>
  );
}

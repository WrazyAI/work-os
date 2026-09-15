import type { CSSProperties } from "react";

export type OttoPose = "idle" | "sleep" | "focus" | "alert" | "rest" | "think" | "celebrate" | "recover";
export type OttoTone = "signal" | "late";

/** Otto — the Work OS focus robot. One rounded body, one signal-green visor,
 * a lamp antenna, hover hands, and a pose per real workday state.
 * The SVG is intentionally small so the silhouette survives favicon sizes.
 * `tone="late"` is the one documented palette exception: the signal accents
 * render danger red until a late-start reason is recorded (design.md §8). */
export function Otto({ pose = "idle", tone = "signal", className = "", style }: { pose?: OttoPose; tone?: OttoTone; className?: string; style?: CSSProperties }) {
  return <svg className={`otto${className ? ` ${className}` : ""}`} data-pose={pose} data-tone={tone} style={style} viewBox="0 0 96 96" role="img" aria-label={`Otto, the Work OS companion, ${tone === "late" ? "late start needs a reason" : pose}`}>
    <ellipse className="otto-shadow" cx="48" cy="87" rx="23" ry="4.5" />
    <g className="otto-figure">
      <path className="otto-antenna" d="M48 31V20" />
      <circle className="otto-bulb" cx="48" cy="16" r="4.5" />
      <circle className="otto-hand hand-left" cx="15" cy="62" r="4" />
      <circle className="otto-hand hand-right" cx="81" cy="62" r="4" />
      <path className="otto-shell" d="M21 57c0-16.5 12-28 27-28s27 11.5 27 28-12 26-27 26-27-9.5-27-26Z" />
      <path className="otto-foot foot-left" d="M33 83h9" />
      <path className="otto-foot foot-right" d="M54 83h9" />
      <path className="otto-badge" d="M41 74h14" />
      <rect className="otto-visor" x="30" y="43" width="36" height="22" rx="11" />
      <g className="otto-face">
        {pose === "idle" && <circle className="otto-eye" cx="48" cy="54" r="5.5" />}
        {pose === "focus" && <><circle className="otto-eye" cx="48" cy="54" r="4" /><circle className="otto-ring" cx="48" cy="54" r="8.5" /></>}
        {pose === "sleep" && <path className="otto-line" d="M39 54q9 5 18 0" />}
        {pose === "alert" && <><circle className="otto-ring ring-pulse" cx="48" cy="54" r="8" /><circle className="otto-eye" cx="48" cy="54" r="3.2" /></>}
        {pose === "rest" && <path className="otto-moon" d="M51.5 48a6.5 6.5 0 1 0 0 13 5.4 5.4 0 1 1 0-13Z" />}
        {pose === "think" && <><circle className="otto-dot dot-1" cx="39.5" cy="54" r="2.4" /><circle className="otto-dot dot-2" cx="48" cy="54" r="2.4" /><circle className="otto-dot dot-3" cx="56.5" cy="54" r="2.4" /></>}
        {pose === "celebrate" && <><path className="otto-line" d="M39 53q4.5 4 9 0" /><circle className="otto-eye" cx="56.5" cy="54" r="4.5" /></>}
        {pose === "recover" && <path className="otto-line" d="M39 56q9-5.5 18 0" />}
      </g>
    </g>
    {pose === "celebrate" && <g className="otto-sparkles">
      <path d="m20 30 1.6 4.4L26 36l-4.4 1.6L20 42l-1.6-4.4L14 36l4.4-1.6Z" />
      <path d="m78 26 1.3 3.5L83 31l-3.7 1.3L78 36l-1.3-3.7L73 31l3.7-1.3Z" />
    </g>}
    {pose === "recover" && <path className="otto-concern" d="M74 28h6M77 23v10" />}
    {tone === "late" && <g className="otto-late-mark">
      <circle cx="77" cy="27" r="6" />
      <path d="M77 23.5V27l2.4 1.6" />
    </g>}
  </svg>;
}

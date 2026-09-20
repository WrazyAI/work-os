import { useId } from "react";
import type { MascotRendererProps } from "./mascotTypes";

const VIEWBOX = {
  full: "0 0 112 112",
  head: "18 12 76 72",
} as const;

/**
 * Signal Spirit — Work OS's digital-organic companion.
 *
 * This SVG is the production fallback and visual-development renderer for the
 * future Rive asset. Its semantic pose/tone contract intentionally matches the
 * Rive state-machine contract documented in signal-spirit.rive.md.
 */
export function SignalSpirit({
  pose = "idle",
  tone = "signal",
  crop = "full",
  className = "",
  style,
  ariaLabel,
}: MascotRendererProps) {
  const uid = useId().replace(/:/g, "");
  const bodyGradient = `spirit-body-${uid}`;
  const rimGradient = `spirit-rim-${uid}`;
  const faceGradient = `spirit-face-${uid}`;
  const glow = `spirit-glow-${uid}`;
  const softGlow = `spirit-soft-glow-${uid}`;
  const full = crop === "full";

  return (
    <svg
      className={`signal-spirit${className ? ` ${className}` : ""}`}
      data-pose={pose}
      data-tone={tone}
      data-crop={crop}
      style={style}
      viewBox={VIEWBOX[crop]}
      role="img"
      aria-label={ariaLabel ?? `Signal Spirit, ${tone === "late" ? "late start needs a reason" : pose}`}
    >
      <defs>
        <radialGradient id={bodyGradient} cx="38%" cy="22%" r="78%">
          <stop offset="0%" stopColor="var(--spirit-highlight)" stopOpacity=".98" />
          <stop offset="52%" stopColor="var(--spirit-body)" stopOpacity=".96" />
          <stop offset="100%" stopColor="var(--spirit-body-edge)" stopOpacity=".94" />
        </radialGradient>
        <linearGradient id={rimGradient} x1="15%" y1="8%" x2="88%" y2="92%">
          <stop offset="0%" stopColor="var(--spirit-rim-hot)" />
          <stop offset="48%" stopColor="var(--spirit-rim)" />
          <stop offset="100%" stopColor="var(--spirit-rim-cool)" />
        </linearGradient>
        <linearGradient id={faceGradient} x1="20%" y1="10%" x2="82%" y2="90%">
          <stop offset="0%" stopColor="var(--spirit-face-hi)" />
          <stop offset="100%" stopColor="var(--spirit-face)" />
        </linearGradient>
        <filter id={glow} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.7" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id={softGlow} x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="5.2" />
        </filter>
      </defs>

      {full && <ellipse className="signal-spirit-shadow" cx="57" cy="99" rx="25" ry="4.5" />}

      <g className="signal-spirit-aura" aria-hidden="true">
        <ellipse cx="56" cy="58" rx="40" ry="42" filter={`url(#${softGlow})`} />
      </g>

      {full && (
        <path
          className="signal-spirit-tail-glow"
          d="M38 78C22 80 15 91 25 97c9 6 23-2 18-10-3-5-13-3-14 3"
          filter={`url(#${glow})`}
        />
      )}
      {full && (
        <path
          className="signal-spirit-tail"
          d="M38 78C22 80 15 91 25 97c9 6 23-2 18-10-3-5-13-3-14 3"
        />
      )}

      <g className="signal-spirit-figure">
        <g className="signal-spirit-beacon" filter={`url(#${glow})`}>
          <path className="signal-spirit-stem" d="M57 26C56 20 59 16 64 13" />
          <circle className="signal-spirit-beacon-ring" cx="66.5" cy="11.5" r="7.5" />
          <circle className="signal-spirit-beacon-core" cx="66.5" cy="11.5" r="3.9" />
        </g>

        {full && <path className="signal-spirit-arm signal-spirit-arm-left" d="M28 61c-8 1-11 6-8 11 2 4 7 4 11 1" />}
        {full && <path className="signal-spirit-arm signal-spirit-arm-right" d="M84 61c8 1 11 6 8 11-2 4-7 4-11 1" />}

        <path
          className="signal-spirit-body"
          fill={`url(#${bodyGradient})`}
          stroke={`url(#${rimGradient})`}
          d="M56 23C38 23 24 37 24 56c0 15 7 25 18 31 4 2 7 7 8 12 1 4 4 6 7 2 3-3 5-7 10-10 13-7 22-18 22-35 0-19-14-33-33-33Z"
        />

        <path
          className="signal-spirit-body-shine"
          d="M35 38c6-8 15-11 24-10M31 48c2-4 4-7 7-10"
        />

        <rect
          className="signal-spirit-face"
          x="32"
          y="39"
          width="49"
          height="35"
          rx="17.5"
          fill={`url(#${faceGradient})`}
        />
        <path className="signal-spirit-face-rim" d="M36 45c7-8 32-9 41 1" />

        <g className="signal-spirit-expression" filter={`url(#${glow})`}>
          {(pose === "idle" || pose === "focus") && (
            <>
              <path className="signal-spirit-eye eye-left" d="M42 56c2.2-4 5.7-4 7.9 0" />
              <path className="signal-spirit-eye eye-right" d="M63 56c2.2-4 5.7-4 7.9 0" />
              {pose === "focus" && <path className="signal-spirit-mouth" d="M53 64c2.4 1.4 4.8 1.4 7.2 0" />}
            </>
          )}

          {(pose === "sleep" || pose === "rest") && (
            <>
              <path className="signal-spirit-eye eye-left" d="M41 57c3 2.5 6 2.5 9 0" />
              <path className="signal-spirit-eye eye-right" d="M62 57c3 2.5 6 2.5 9 0" />
              {pose === "rest" && <path className="signal-spirit-mouth" d="M54 65c2 1 4 1 6 0" />}
            </>
          )}

          {pose === "alert" && (
            <>
              <circle className="signal-spirit-eye alert-eye" cx="46" cy="56" r="3.6" />
              <circle className="signal-spirit-eye alert-eye" cx="67" cy="56" r="3.6" />
              <circle className="signal-spirit-alert-dot" cx="56.5" cy="65" r="1.5" />
            </>
          )}

          {pose === "think" && (
            <>
              <path className="signal-spirit-eye eye-left think-eye" d="M41 56c2-3.2 5.2-4.2 8.2-1.8" />
              <path className="signal-spirit-eye eye-right think-eye" d="M63 54c2.3-2.2 5.1-2.1 7.4.2" />
              <circle className="signal-spirit-thought thought-1" cx="78" cy="37" r="1.8" />
              <circle className="signal-spirit-thought thought-2" cx="84" cy="31" r="2.4" />
              <circle className="signal-spirit-thought thought-3" cx="90" cy="23" r="3.1" />
            </>
          )}

          {pose === "celebrate" && (
            <>
              <path className="signal-spirit-eye eye-left" d="M40 57c3-5 7-5 10 0" />
              <path className="signal-spirit-eye eye-right" d="M62 57c3-5 7-5 10 0" />
              <path className="signal-spirit-mouth signal-spirit-smile" d="M51 63c3.6 4 7.4 4 11 0" />
            </>
          )}

          {pose === "recover" && (
            <>
              <path className="signal-spirit-eye eye-left recover-eye" d="M41 54l8 2" />
              <path className="signal-spirit-eye eye-right recover-eye" d="M63 56l8-2" />
              <path className="signal-spirit-mouth" d="M52 66c3-2 6-2 9 0" />
            </>
          )}
        </g>

        {full && (
          <g className="signal-spirit-core" filter={`url(#${glow})`}>
            <circle className="signal-spirit-core-ring" cx="57" cy="82" r="5.5" />
            <circle className="signal-spirit-core-dot" cx="57" cy="82" r="2.1" />
          </g>
        )}
      </g>

      {pose === "celebrate" && (
        <g className="signal-spirit-sparks" filter={`url(#${glow})`}>
          <path className="spark spark-1" d="m20 33 2 4 4 2-4 2-2 4-2-4-4-2 4-2Z" />
          <path className="spark spark-2" d="m91 40 1.5 3 3 1.5-3 1.5-1.5 3-1.5-3-3-1.5 3-1.5Z" />
          <circle className="spark spark-3" cx="84" cy="20" r="2.2" />
        </g>
      )}

      {pose === "alert" && (
        <g className="signal-spirit-ping" filter={`url(#${glow})`}>
          <circle cx="66.5" cy="11.5" r="11" />
          <circle cx="66.5" cy="11.5" r="15" />
        </g>
      )}

      {tone === "late" && (
        <g className="signal-spirit-late" filter={`url(#${glow})`}>
          <circle cx="89" cy="27" r="6.5" />
          <path d="M89 23.5V27l2.6 1.7" />
        </g>
      )}
    </svg>
  );
}

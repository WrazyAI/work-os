import { useId, type CSSProperties } from "react";
import type { MascotPose, MascotRendererProps } from "./mascotTypes";
import { STUDIO_PALETTES, studioOttoPalette } from "./studioOttoPalette";
import "./studio-otto.css";

const VIEWBOX = { full: "0 0 160 180", head: "9 10 142 110" } as const;

/** Terminal glyphs are paths, not font-dependent text or an image of a face. */
function TerminalFace({ pose }: { pose: MascotPose }) {
  switch (pose) {
    case "think":
      return <g className="studio-terminal-working">
        <path d="m56 49 14 11-14 11" />
        <path className="studio-cursor" d="M83 73h16" />
        <g className="studio-dot-fill">
          <circle className="studio-dot dot-1" cx="70" cy="88" r="2.2" />
          <circle className="studio-dot dot-2" cx="81" cy="88" r="2.2" />
          <circle className="studio-dot dot-3" cx="92" cy="88" r="2.2" />
        </g>
      </g>;
    case "alert":
      return <g className="studio-terminal-question">
        <path d="M70 50c0-12 22-12 22 0 0 8-11 7-11 17" />
        <path d="M81 79v1M98 87h12" />
      </g>;
    case "celebrate":
      return <g className="studio-terminal-ready">
        <path d="m51 63 8-11 8 11m24 0 8-11 8 11M71 81l7 6 13-13" />
      </g>;
    case "recover":
      return <g className="studio-terminal-error">
        <path d="m57 49 19 20m0-20L57 69M89 81h15" />
      </g>;
    case "sleep":
    case "rest":
      return <g className="studio-terminal-rest">
        <path d="M49 63h15m30 0h15M74 83h12" />
      </g>;
    default:
      return <g className="studio-terminal-idle">
        <path className="studio-eye eye-left" d="M57 50v16" />
        <path className="studio-eye eye-right" d="M101 50v16" />
        <path className="studio-prompt" d="m72 79 7 6-7 6" />
        <path className="studio-cursor" d="M85 91h10" />
      </g>;
  }
}

/** Approved Studio Otto: large retro monitor, compact ivory chassis.
 * Local SVG renderer; no network, random values, timers, or animation runtime.
 * Full/head crops share identity but the mark omits props, filters, and motion. */
export function StudioOtto({
  pose = "idle", tone = "signal", crop = "full", className = "", style, ariaLabel,
}: MascotRendererProps) {
  const uid = `studio-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const id = (part: string) => `${uid}-${part}`;
  const fill = (part: string) => `url(#${id(part)})`;
  const full = crop === "full";
  const working = pose === "think";
  const resting = pose === "sleep" || pose === "rest";
  const palette = studioOttoPalette(pose, tone);
  const colors = STUDIO_PALETTES[palette];
  const artStyle = {
    "--studio-phosphor": colors.phosphor,
    "--studio-accent": colors.accent,
    "--studio-wash": colors.wash,
    ...style,
  } as CSSProperties;

  return <svg xmlns="http://www.w3.org/2000/svg"
    className={`studio-otto${className ? ` ${className}` : ""}`}
    data-pose={pose} data-tone={tone} data-crop={crop} data-palette={palette}
    viewBox={VIEWBOX[crop]} style={artStyle} role="img" focusable="false"
    aria-label={ariaLabel ?? `Studio Otto, ${pose}${tone === "late" ? ", late start needs a reason" : ""}`}>
    <defs>
      <linearGradient id={id("shell")} x1="15%" y1="0%" x2="85%" y2="100%">
        <stop stopColor="#fffefa" /><stop offset=".42" stopColor="#efede7" />
        <stop offset=".8" stopColor="var(--studio-wash)" /><stop offset="1" stopColor="#b9b7ae" />
      </linearGradient>
      <linearGradient id={id("edge")} x1="0%" y1="15%" x2="95%" y2="85%">
        <stop stopColor="#c5c3ba" /><stop offset=".4" stopColor="#eeeae3" />
        <stop offset="1" stopColor="#93968f" />
      </linearGradient>
      <linearGradient id={id("metal")} x1="0%" y1="0%" x2="100%" y2="25%">
        <stop stopColor="#161c20" /><stop offset=".38" stopColor="#576164" />
        <stop offset=".65" stopColor="#313a3e" /><stop offset="1" stopColor="#151b1e" />
      </linearGradient>
      <linearGradient id={id("glass")} x1="0%" y1="0%" x2="85%" y2="100%">
        <stop stopColor="#343c3c" /><stop offset=".48" stopColor="#21292a" />
        <stop offset="1" stopColor="#11191c" />
      </linearGradient>
      <linearGradient id={id("reflection")} x1="0%" y1="0%" x2="30%" y2="100%">
        <stop stopColor="#fff" stopOpacity=".12" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
      <clipPath id={id("screen")}>
        <path d="M48 34Q80 29 111 34Q123 36 124 49L124 83Q124 96 111 99Q80 104 48 99Q35 97 35 83V49Q35 36 48 34Z" />
      </clipPath>
      {full && <filter id={id("phosphor")} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
        <feGaussianBlur stdDeviation="1.25" result="bloom" />
        <feMerge><feMergeNode in="bloom" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>}
    </defs>

    {full && <ellipse className="studio-shadow" cx="80" cy="170" rx="37" ry="4.5" fill="#19221e" fillOpacity=".16" />}
    <g className="studio-rig">
      {full && <g className="studio-chassis">
        <rect x="56" y="148" width="20" height="13" rx="6" fill={fill("metal")} />
        <rect x="85" y="148" width="20" height="13" rx="6" fill={fill("metal")} />
        <path d="M55 154Q62 150 74 155L75 164Q73 170 57 168Q50 167 51 163Z" fill={fill("shell")} stroke="#a7aba3" strokeWidth=".8" />
        <path d="M87 154Q97 150 104 155L109 163Q110 169 94 169Q85 168 85 164Z" fill={fill("shell")} stroke="#a7aba3" strokeWidth=".8" />
        <rect x="62" y="101" width="37" height="14" rx="6" fill={fill("metal")} />
        {!working && <g className="studio-arm studio-arm-left">
          <path d="M51 113Q40 114 35 131L33 140Q34 145 44 146L55 123Z" fill={fill("edge")} stroke="#a1a79f" strokeWidth=".7" />
          <path d="M37 125Q48 124 48 133L45 146Q43 151 35 149Q28 148 30 142Z" fill={fill("shell")} />
          <ellipse cx="37" cy="149" rx="6" ry="6.5" fill={fill("metal")} />
          <path d="M34 128l11 4" stroke="#b5bab1" strokeWidth=".7" />
        </g>}
        {working && <g className="studio-working-arms">
          <path d="M55 115Q42 118 42 139L52 141L61 126Z" fill={fill("shell")} stroke="#a1a79f" strokeWidth=".7" />
          <path d="M103 115q15 5 15 23l-10 4-9-17Z" fill={fill("shell")} stroke="#a1a79f" strokeWidth=".7" />
        </g>}
        <path d="M60 109Q80 106 99 109Q109 115 111 137Q113 153 101 158Q81 164 58 157Q48 154 49 140Q50 117 60 109Z" fill={fill("shell")} stroke="#abb0a6" strokeWidth=".8" />
        <path d="M61 115Q79 112 99 115" stroke="#fffef7" strokeWidth="1.3" fill="none" />
        <g stroke="#46504f" strokeWidth="2.5" strokeLinecap="round">
          <path d="M62 127h17m-17 5h17m-17 5h17" />
        </g>
        <circle cx="95" cy="130" r="7" fill={fill("metal")} />
        <circle className="studio-power" cx="95" cy="130" r="4.5" fill="var(--studio-phosphor)" />
        <path d="M57 150Q81 157 103 151" stroke="#a1a89e" strokeWidth=".8" fill="none" opacity=".5" />
        {!working && <g className="studio-arm studio-arm-right">
          <path d="M105 113Q117 117 122 134L125 142Q123 147 115 146L103 123Z" fill={fill("edge")} stroke="#a1a79f" strokeWidth=".7" />
          <path d="M113 126Q120 124 124 134L128 143Q129 149 121 151Q114 153 112 145Z" fill={fill("shell")} />
          <ellipse cx="123" cy="150" rx="6" ry="6.5" fill={fill("metal")} />
          <path d="m115 130 9-3" stroke="#b5bab1" strokeWidth=".7" />
        </g>}
      </g>}

      <g className="studio-head">
        <path d="M42 15Q79 8 119 15Q140 18 141 40L141 84Q139 108 119 111Q80 117 40 109Q21 106 20 86V43Q20 21 42 15Z" fill={fill("edge")} stroke="#adb2a9" strokeWidth=".8" />
        <path d="M43 16Q79 11 115 17Q136 20 137 41V85Q136 105 116 110Q80 115 44 109Q23 106 23 85V43Q23 23 43 16Z" fill={fill("shell")} />
        <path d="M38 27Q44 19 65 19L110 20Q122 21 127 26" stroke="#fffef9" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity=".9" />
        <ellipse cx="22" cy="65" rx="9" ry="25" fill="#8c9591" />
        <ellipse cx="20" cy="65" rx="8" ry="24" fill={fill("metal")} />
        <path d="M20 43C11 46 11 84 20 88" stroke="var(--studio-accent)" strokeWidth="1.8" fill="none" />
        <ellipse cx="139" cy="65" rx="7" ry="23" fill={fill("metal")} />
        <path d="M141 44c6 4 6 37 0 42" stroke="var(--studio-accent)" strokeWidth="1.4" fill="none" />
        <path d="M47 30Q80 25 113 30Q128 32 129 48L129 85Q128 101 113 103Q80 108 47 103Q31 101 31 85V48Q31 32 47 30Z" fill="#969d95" />
        <path d="M48 32Q80 27 112 32Q126 34 126 49L126 84Q126 99 112 101Q80 106 48 101Q33 99 33 84V49Q33 34 48 32Z" fill="#111b1c" />
        <g clipPath={fill("screen")}>
          <rect x="34" y="29" width="92" height="77" fill={fill("glass")} />
          {full && <g className="studio-screen-texture">
            <path d="M35 46h89M35 50h89M35 54h89M35 58h89M35 62h89M35 66h89M35 70h89M35 74h89M35 78h89M35 82h89M35 86h89M35 90h89M35 94h89" stroke="#d8e6d9" strokeWidth=".35" opacity=".045" />
            <path d="M36 45Q67 26 124 35V57Q72 46 36 65Z" fill={fill("reflection")} />
          </g>}
          <g className="studio-gaze">
            <g className="studio-face" filter={full ? fill("phosphor") : undefined}>
              <TerminalFace pose={pose} />
            </g>
          </g>
        </g>
        <path d="M48 103Q80 108 113 103" stroke="#fffef6" strokeWidth="1.3" fill="none" opacity=".8" />
      </g>

      {full && resting && <g className="studio-sleep-zs" aria-hidden="true">
        <path className="studio-sleep-z z-1" d="M123 40h8l-8 8h8" />
        <path className="studio-sleep-z z-2" d="M133 28h9l-9 9h9" />
        <path className="studio-sleep-z z-3" d="M141 15h10l-10 10h10" />
      </g>}

      {full && working && <g className="studio-taskpad">
        <path d="M53 124h53q4 0 3 5l-5 22H50l-2-21q-1-6 5-6Z" fill={fill("metal")} stroke="#7f8983" strokeWidth=".9" />
        <path d="M54 128h48l-3 18H55Z" fill="#222c2b" />
        <path d="M65 135h20M65 140h12" stroke="var(--studio-phosphor)" strokeWidth="1.7" strokeLinecap="round" />
        <rect className="studio-pad-cursor" x="88" y="134" width="5" height="3" rx=".5" fill="var(--studio-accent)" />
        <ellipse cx="49" cy="141" rx="5.5" ry="7" fill={fill("shell")} stroke="#9fa69e" strokeWidth=".7" />
        <g className="studio-typing-hand"><ellipse cx="105" cy="141" rx="5.5" ry="7" fill={fill("shell")} stroke="#9fa69e" strokeWidth=".7" /></g>
      </g>}
      {full && tone === "late" && <g className="studio-late" aria-hidden="true">
        <circle cx="133" cy="112" r="8" fill="#fbfaf5" stroke="#c94e43" strokeWidth="1.4" />
        <path d="M133 108v4l3 2" stroke="#c94e43" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </g>}
    </g>
  </svg>;
}

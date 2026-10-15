import { useState, type CSSProperties } from "react";
import type { MascotRendererProps } from "./mascotTypes";
import { StudioOtto } from "./StudioOtto";
import { STUDIO_PALETTES, studioOttoPalette } from "./studioOttoPalette";
import "./sprite-otto.css";

const loadedAtlases = new Set<string>();

/** The SVG remains the compact mark, resting pose and asset-failure fallback. */
export function SpriteOtto(props: MascotRendererProps) {
  const [loaded, setLoaded] = useState(() => !!props.motion && loadedAtlases.has(props.motion.src));
  const [failed, setFailed] = useState(false);
  const { motion, pose = "idle", tone = "signal", className = "", style, ariaLabel } = props;
  if (props.crop === "head" || failed || !motion || (tone === "late" && (pose === "idle" || pose === "focus"))) return <StudioOtto {...props} />;
  const palette = studioOttoPalette(pose, tone);
  const spriteStyle = { ...style, "--studio-phosphor": STUDIO_PALETTES[palette].phosphor,
    "--pet-atlas": `url("${motion.src}")`, "--pet-column": motion.frame, "--pet-row": motion.row } as CSSProperties;
  return <span className={`${loaded ? "studio-otto " : ""}otto-sprite ${className}`} data-pose={pose} data-tone={tone}
    data-clip={motion.clip} data-frame={motion.frame} data-row={motion.row} data-loaded={loaded} data-palette={palette}
    style={spriteStyle} role={loaded ? "img" : undefined} aria-label={loaded ? ariaLabel : undefined}>
    <img className="otto-atlas-loader" src={motion.src} alt="" aria-hidden="true"
      onLoad={() => { loadedAtlases.add(motion.src); setLoaded(true); }} onError={() => setFailed(true)} />
    {loaded ? <span className="otto-sprite-frame" aria-hidden="true" /> : <StudioOtto {...props} />}
    {loaded && tone === "late" && <svg className="otto-sprite-late" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="#fbfaf5" stroke="#c94e43" strokeWidth="1.4" /><path d="M10 5v5l4 2" fill="none" stroke="#c94e43" strokeWidth="1.6" strokeLinecap="round" /></svg>}
  </span>;
}

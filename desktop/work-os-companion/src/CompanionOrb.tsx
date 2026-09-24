import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { MASCOT } from "./mascot";
import { MascotPet } from "./MascotPet";
import type { MascotAgentActivity, MascotWorkdayState } from "./mascotState";

export interface CompanionOrbPrompt {
  heading: string;
  compact: string;
}

export interface CompanionOrbProps {
  agent?: MascotAgentActivity;
  workday: MascotWorkdayState;
  label: string;
  prompt?: CompanionOrbPrompt;
  showShiftTime?: boolean;
  elapsedText?: string;
  progressText?: string;
  showBadge?: boolean;
  progressAvailable?: boolean;
  fraction?: number;
  replayKey?: number;
  isolated?: boolean;
  title?: string;
  ariaLabel?: string;
  onOpen: () => void;
  onHide: () => void;
}

/** The collapsed companion is a single-purpose signal surface. It owns the
 * compact mascot crop and its immediate status affordances so AvatarApp does
 * not accumulate another generation of mascot-specific shell markup. */
export function CompanionOrb({
  agent,
  workday,
  label,
  prompt,
  showShiftTime = false,
  elapsedText = "",
  progressText = "",
  showBadge = false,
  progressAvailable = false,
  fraction = 0,
  replayKey = 0,
  isolated = false,
  title,
  ariaLabel,
  onOpen,
  onHide,
}: CompanionOrbProps) {
  const resolvedTitle = title ?? (showShiftTime ? `${elapsedText} · ${progressText}` : "Work OS companion");
  const resolvedAriaLabel = ariaLabel
    ?? (showShiftTime
      ? `${MASCOT.name}: ${label}. ${elapsedText}. ${progressText}.`
      : showBadge
        ? `${MASCOT.name}: ${label}. Open companion to respond.`
        : `Open ${MASCOT.name} companion`);

  const progressStyle = showShiftTime && !showBadge && progressAvailable
    ? { "--shift-progress": `${Math.max(0, Math.min(1, fraction)) * 100}%` } as CSSProperties
    : undefined;

  return (
    <div className="avatar-compact">
      {prompt && (
        <button className="avatar-prompt-bubble" onClick={onOpen}>
          <strong>{prompt.heading}</strong>
          <span>{prompt.compact}</span>
        </button>
      )}
      <span className="avatar-drag-surface" data-tauri-drag-region title="Drag to move the companion" aria-hidden="true">⋮⋮</span>
      <button className="avatar-hide" onClick={onHide} aria-label="Hide companion" title="Hide companion">
        <X size={13} aria-hidden="true" />
      </button>
      <button className="avatar-orb" onClick={onOpen} title={resolvedTitle} aria-label={resolvedAriaLabel}>
        <MascotPet
          isolated={isolated}
          agent={agent}
          workday={workday}
          crop="orb"
          className="avatar-pet"
          artClassName="avatar-pet-art"
          replayKey={replayKey}
        />
        <span className="avatar-orb-state">{label}</span>
        {(showShiftTime || showBadge) && (
          <span
            className={`avatar-badge${showShiftTime && !showBadge ? " avatar-badge-progress" : ""}${showShiftTime && !showBadge && !progressAvailable ? " avatar-badge-progress-unavailable" : ""}`}
            style={progressStyle}
            aria-hidden="true"
          />
        )}
      </button>
      {showShiftTime && <span className="avatar-day-time" aria-hidden="true">{elapsedText}</span>}
    </div>
  );
}

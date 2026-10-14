import { Fragment, useMemo, type CSSProperties, type ReactNode } from "react";
import { MascotPet } from "./MascotPet";
import { MASCOT } from "./mascot";
import wordmark from "./assets/work-os-mark.png";

type AssetSource = string | { src: string };
const assetUrl = (asset: AssetSource) => typeof asset === "string" ? asset : asset.src;

/**
 * The first-run stage: Otto, what he says, and how far along the setup is.
 *
 * Onboarding is the one surface where the employee has not met the product yet,
 * so it is the one place where the companion carries the experience instead of
 * annotating it. Everything here renders the configured mascot through
 * `MascotPet`, and every pose below maps to a real state — Otto is never
 * animated for decoration.
 */

/** Pose recipes for the first-run sequence.
 *
 * This stage deliberately opts out of the application runtime: there is no
 * workspace state yet for that snapshot to mirror, and a completed setup really
 * is a finished thing even though the day's facts still say nothing started. */
export const STAGE_POSE = {
  /** Before Otto has spoken. */
  waiting: { agent: "idle", workday: "disconnected" },
  /** Listening while the employee answers. */
  attending: { agent: "idle", workday: "active" },
  /** Doing real work: preparing the workspace. */
  working: { agent: "working", workday: "active" },
  /** Something finished, worth one celebration. */
  done: { agent: "ready", workday: "active" },
} as const;

export type StagePose = keyof typeof STAGE_POSE;

const WORD_MS = 26;
/** Past this the reveal would outlast the moment; the line just renders. */
const MAX_REVEAL_WORDS = 48;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * One line of Otto's speech.
 *
 * Screen readers get the whole sentence at once; the visible copy resolves word
 * by word out of a soft blur and then stops. The reveal is pure CSS with no
 * timer and no loop, so it cannot outlive the line, replay on its own, or
 * compete with another animation. Reduced motion renders it flat.
 */
export function OttoLine({ text }: { text: string }) {
  const words = useMemo(() => text.split(/\s+/).filter(Boolean), [text]);
  const reveal = words.length <= MAX_REVEAL_WORDS && !prefersReducedMotion();
  const settleMs = reveal ? words.length * WORD_MS + 180 : 0;
  return <p className="otto-line" style={{ "--otto-settle": `${settleMs}ms` } as CSSProperties}>
    {/* The speaker is named here rather than in a visible label: the bubble's
        tail already shows who is talking. */}
    <span className="sr-only">{MASCOT.name}: {text}</span>
    <span aria-hidden="true">{words.map((word, index) => <Fragment key={index}>
      {index > 0 ? " " : null}
      <span
        className="otto-line-word"
        style={reveal ? { animationDelay: `${index * WORD_MS}ms` } : undefined}
      >{word}</span>
    </Fragment>)}</span>
  </p>;
}

export interface OnboardingStageProps {
  pose: StagePose;
  /** The quiet label above the statement. */
  eyebrow: string;
  /** The step's purpose, set as the screen's one hero statement. */
  title: string;
  /** Otto's spoken explanation for this step. */
  line: string;
  /** The walked progress rail. Omitted before the setup starts. */
  journey?: { total: number; index: number; label: string };
  /** Changes per step so the entrance replays instead of morphing. */
  replayKey: string;
  /** Actions that belong to what Otto just said. */
  children?: ReactNode;
}

export function OnboardingStage({
  pose,
  eyebrow,
  title,
  line,
  journey,
  replayKey,
  children,
}: OnboardingStageProps) {
  const recipe = STAGE_POSE[pose];
  return <aside className="onboarding-story" data-pose={pose}>
    <div className="story-brand"><img src={assetUrl(wordmark)} alt="" /><strong>WORK <b>OS</b></strong></div>
    {/* Otto stays mounted for the whole first run: only what he says changes.
        Keying the statement and the bubble replays their entrance per step
        without restarting the figure underneath them. */}
    <div className="onboarding-stage-body">
      <div className="stage-statement" key={replayKey}>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
      </div>
      <div className="otto-scene">
        <div className="otto-bubble" key={replayKey}>
          <OttoLine text={line} />
          {children}
        </div>
        <MascotPet
          isolated
          agent={recipe.agent}
          workday={recipe.workday}
          className="mascot-stage"
          artClassName="mascot-stage-art"
        />
      </div>
    </div>
    {journey && <div
      className="otto-journey"
      role="group"
      aria-label={`Setup progress: step ${journey.index + 1} of ${journey.total}, ${journey.label}`}
    >
      <span className="sr-only" aria-live="polite">{`Step ${journey.index + 1} of ${journey.total}: ${journey.label}`}</span>
      {Array.from({ length: journey.total }, (_, index) => <i
        key={index}
        aria-hidden="true"
        data-state={index < journey.index ? "done" : index === journey.index ? "now" : "next"}
      />)}
    </div>}
  </aside>;
}

/**
 * Reading a recap aloud, on the companion's side: the pieces that are pure
 * arithmetic and copy, so the promise held in the design — the last line lands
 * exactly when the voice stops, and the bubble grows without moving Otto — is
 * testable without a window, an audio element, or a provider.
 *
 * The words themselves come from the server (`x-work-os-recap-lines`), never
 * assembled here: the card, the prompter and the voice render one text.
 */

export interface RecapSpeechLine {
  /** The words Otto says, exactly as the recap has them. */
  text: string;
  /** The clock time the card shows as its own pill; never spoken. */
  time: string | null;
  /** The surface line this speaks, when the caller wants to highlight it in
   * place instead of showing a separate prompter (`lead`, `<id>:title`,
   * `<id>:why`). Never spoken and never rendered as text. */
  ref?: string | null;
}

/** The voices the app ships.
 *
 * `id` is what the provider answers to; `label` is the only name the employee
 * ever sees, and it names the delivery rather than the vendor's character, so
 * the picker reads as a choice about how Otto talks to you. The samples are the
 * shipped clips (see `public/voices/README.md`), which makes auditioning free
 * and independent of the network. The server's whitelist must match these ids;
 * a companion test asserts the shipped files match these labels. */
export const RECAP_VOICE_OPTIONS = [
  { id: "Kore", label: "Warm", sample: "/voices/warm.mp3" },
  { id: "Charon", label: "Calm", sample: "/voices/calm.mp3" },
  { id: "Leda", label: "Bright", sample: "/voices/bright.mp3" },
  { id: "Iapetus", label: "Deep", sample: "/voices/deep.mp3" },
] as const;

export const DEFAULT_RECAP_VOICE: string = RECAP_VOICE_OPTIONS[0].id;

/** Fired when the employee picks a voice in Settings; the floating companion
 * listens so the next read uses it without a restart. */
export const RECAP_VOICE_EVENT = "work-os://recap-voice-changed";

export function normalizeRecapVoice(value: unknown): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  return RECAP_VOICE_OPTIONS.some((option) => option.id === candidate) ? candidate : DEFAULT_RECAP_VOICE;
}

/* ── The prompter's clock ─────────────────────────────────────────────────── */

/** The pause a sentence ends with, in characters: a short line still owns a
 * little more of the read than its length alone suggests. */
const LINE_PAUSE = 12;

/** Each line's share of the read, proportional to what it costs to say. */
export function lineWeights(lines: RecapSpeechLine[]): number[] {
  if (!lines.length) return [];
  return lines.map((line) => Math.max(1, line.text.trim().length + LINE_PAUSE));
}

function windows(weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) return [];
  const bounds: number[] = [];
  let running = 0;
  for (const weight of weights) {
    running += weight;
    bounds.push(running / total);
  }
  return bounds;
}

/** Which line is being spoken at `progress` (0–1 of the audio). At 1 this is
 * always the last line, which is what makes the read land on the end. */
export function activeLineIndex(progress: number, weights: number[]): number {
  if (!weights.length) return 0;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const bounds = windows(weights);
  for (let index = 0; index < bounds.length; index += 1) {
    if (clamped <= bounds[index]) return index;
  }
  return weights.length - 1;
}

/** How far the prompter has travelled, 0 at the first line and 1 at the last,
 * weighted the same way as the highlight so the words and the motion agree. */
export function prompterScroll(progress: number, weights: number[]): number {
  if (weights.length < 2) return 0;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const bounds = windows(weights);
  const index = activeLineIndex(clamped, weights);
  const lower = index === 0 ? 0 : bounds[index - 1];
  const upper = bounds[index];
  const within = upper > lower ? (clamped - lower) / (upper - lower) : 0;
  return Math.min(1, Math.max(0, (index + within) / (weights.length - 1)));
}

/* ── The window while it reads ────────────────────────────────────────────── */

export interface WindowSize {
  width: number;
  height: number;
}
export interface WindowPosition {
  x: number;
  y: number;
}
export interface PrompterMetrics {
  /** One prompter line's height in CSS pixels. */
  lineHeight: number;
  /** How many lines the prompter shows at once. */
  prompterLines: number;
  /** Everything else the grown bubble adds: padding, the label row, the
   * progress hairline. */
  chrome: number;
}

/** The resting bubble's size, mirrored from the avatar window's own constants
 * so this math can be tested without importing the window. */
export const RECAP_BUBBLE_RESTING: WindowSize = { width: 200, height: 276 };
/** How wide the reading bubble may become — a comfortable measure for three
 * lines, never the full screen. */
export const RECAP_BUBBLE_READING_WIDTH = 320;

/** The window while Otto reads: taller by the prompter, wider to a readable
 * measure, grown upward when the monitor has room above (the companion usually
 * sits at the bottom) and downward when it does not, always clamped so no part
 * of the bubble leaves the monitor. The mascot and the elapsed pill keep their
 * place because the bottom edge never moves unless the monitor forces it. */
export function grownWindow(
  base: WindowSize,
  metrics: PrompterMetrics,
  monitor: WindowSize,
  position: WindowPosition,
): { size: WindowSize; position: WindowPosition } {
  return grownWindowFor(
    base,
    Math.round(metrics.lineHeight * metrics.prompterLines + metrics.chrome),
    monitor,
    position,
  );
}

/** The same growth for a bubble whose height is already known (the next-steps
 * moment computes it from its item count): widen to the reading measure, add
 * the delta upward, and clamp inside the monitor. The bottom edge — and with
 * it the mascot and elapsed pill — stays put, exactly like the prompter. */
export function grownWindowFor(
  base: WindowSize,
  heightDeltaInput: number,
  monitor: WindowSize,
  position: WindowPosition,
): { size: WindowSize; position: WindowPosition } {
  const heightDelta = Math.max(0, Math.round(heightDeltaInput));
  // Wider only when the monitor can hold the reading measure with a margin to
  // spare; otherwise the bubble keeps its resting width and the rows wrap.
  const width = monitor.width >= RECAP_BUBBLE_READING_WIDTH + 24 ? RECAP_BUBBLE_READING_WIDTH : base.width;
  const height = Math.min(monitor.height, base.height + heightDelta);
  // Grow about the window's own centre so the mascot under it does not slide
  // sideways, then clamp: an edge can only move the bubble as far as it must.
  const centred = position.x - (width - base.width) / 2;
  const x = Math.max(0, Math.min(centred, Math.max(0, monitor.width - width)));
  const growUpward = position.y >= heightDelta;
  const grown = growUpward ? position.y - heightDelta : position.y;
  const y = Math.max(0, Math.min(grown, Math.max(0, monitor.height - height)));
  return { size: { width, height }, position: { x, y } };
}

/* ── Failures, in the employee's words ────────────────────────────────────── */

/** Mirrors the server's copy for the same reasons. The client only ever sees a
 * bounded message from the route; these cover the cases the client itself
 * detects (offline, an unreadable response). */
export function recapSpeechFailureCopy(reason: "offline" | "unavailable"): string {
  return reason === "offline"
    ? "Reading a recap needs a connection. You can still read it below."
    : "Reading a recap is unavailable right now. Try again in a moment.";
}

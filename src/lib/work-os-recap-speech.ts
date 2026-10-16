/**
 * The words a recap is read aloud with.
 *
 * Exactly one source of truth: the lines are the recap's own text — the lead
 * line first, then each activity — with the clock time lifted out of the line
 * the way the card already lifts it into a pill. Nothing is paraphrased, no
 * connective words are added, and the flow chips, evidence counts, screenshots,
 * gap notes and recorded GitHub facts are never spoken (a read that invented or
 * dropped a detail would defeat the reason the employee is listening: to check
 * that what was recorded is what happened).
 *
 * The spoken text is what the prompter shows, because both come from here.
 */

import { splitActivityTime } from "./activity-time";

/** A recap longer than this is refused rather than billed and read; real
 * recaps are twelve activities of at most ten words each. */
export const RECAP_SPEECH_MAX_CHARS = 6000;

export type RecapSpeechLine = {
  /** The words Otto says. */
  text: string;
  /** The clock time the card shows as its own pill, or null. Never spoken. */
  time: string | null;
};

export type RecapSpeechSource = {
  detail?: string | null;
  headline?: string | null;
  activities?: unknown;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** The recap's own lines, in order: the lead line, then each activity. */
export function buildRecapSpeechLines(interval: RecapSpeechSource): RecapSpeechLine[] {
  const lead = clean(interval.detail) || clean(interval.headline);
  const activities = Array.isArray(interval.activities) ? interval.activities : [];
  const lines: RecapSpeechLine[] = [];
  if (lead) lines.push({ text: lead, time: null });
  for (const activity of activities) {
    const raw = clean(activity);
    if (!raw) continue;
    const { time, text } = splitActivityTime(raw);
    if (text) lines.push({ text, time });
  }
  const spoken = lines.reduce((total, line) => total + line.text.length, 0);
  if (spoken > RECAP_SPEECH_MAX_CHARS) {
    throw new Error("This recap is too long to read aloud.");
  }
  return lines;
}

/**
 * The words a recap's approved next steps are read aloud with.
 *
 * The suggestions already exist server-side, so the request that asks for a
 * read carries only ids: the lines below are built from the stored proposal
 * titles and rationales, never from text a caller sent. Each line keeps a
 * `ref` back to the suggestion it belongs to, which is what lets the client
 * highlight the row being spoken.
 */

import {
  RECAP_SPEECH_MAX_CHARS,
  synthesizeRecapSpeech,
  type RecapSpeechLine,
  type RecapSpeechResult,
} from "./work-os-recap-speech";

export type NextStepsSpeechSource = {
  label: string | null;
  items: Array<{ proposalId: string; title: string; rationale: string }>;
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** The list's own lines, in order: the lead line, then each suggestion's
 * title and — when it has one — the reason it was suggested. */
export function buildNextStepsSpeechLines(view: NextStepsSpeechSource): RecapSpeechLine[] {
  const label = clean(view.label);
  const lines: RecapSpeechLine[] = [{
    text: label ? `Next steps from your ${label} recap.` : "Next steps from your approved recap.",
    time: null,
    ref: "lead",
  }];
  const items = Array.isArray(view.items) ? view.items : [];
  for (const item of items) {
    const ref = clean(item?.proposalId);
    const title = clean(item?.title);
    if (title) lines.push({ text: title, time: null, ref: `${ref}:title` });
    const rationale = clean(item?.rationale);
    if (rationale) lines.push({ text: rationale, time: null, ref: `${ref}:why` });
  }
  const spoken = lines.reduce((total, line) => total + line.text.length, 0);
  if (spoken > RECAP_SPEECH_MAX_CHARS) {
    throw new Error("This recap is too long to read aloud.");
  }
  return lines;
}

/** Failures are never cached: the next press must be able to reach the provider
 * again once the account, the network, or the suggestion set has changed. */
const CACHE_LIMIT = 32;
const cache = new Map<string, RecapSpeechResult & { ok: true }>();

export function __resetNextStepsSpeechCache() {
  cache.clear();
}

/** One clip per recap per suggestion set per voice. The signature is computed
 * from the items themselves, so a regenerated set is read again rather than
 * played from the previous set's clip. */
export async function speakNextSteps(input: {
  intervalId: string;
  signature: string;
  voice: string;
  lines: RecapSpeechLine[];
  fetchImpl?: typeof fetch;
}): Promise<RecapSpeechResult> {
  const key = `${input.intervalId}:${input.signature}:${input.voice}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await synthesizeRecapSpeech(input);
  if (result.ok) {
    cache.set(key, result);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
  return result;
}

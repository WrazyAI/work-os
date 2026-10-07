/** EOD drafting helpers shared with the companion's flow.
 *
 * The assistant draft is the default on both surfaces: the standard report
 * record is created first, then the AI narrative replaces the placeholder —
 * and a gated or unavailable assistant keeps the standard draft honest. */

/** Matches a real `## Bottleneck` heading line and its body, up to the next
 * `## ` heading or the end of the report. */
const BOTTLENECK_SECTION = /\n+##[ \t]*Bottleneck[ \t]*\n([\s\S]*?)(?=\n{1,2}##[ \t]|\s*$)/i;

/** The refine request must not let the assistant rewrite the Bottleneck
 * section, so that section is stripped before sending. */
export function stripBottleneckSection(markdown: string): string {
  return markdown.replace(BOTTLENECK_SECTION, "").replace(/\s+$/, "");
}

/** The exact Bottleneck section (heading and body) when the draft carries one. */
export function extractBottleneckSection(markdown: string): string {
  return typeof markdown === "string" ? (markdown.match(BOTTLENECK_SECTION)?.[0] ?? "").replace(/^\n+/, "") : "";
}

/** Re-attaches a preserved Bottleneck section to a refined draft unless the
 * refined report already carries one. */
export function restoreBottleneckSection(refined: string, section: string): string {
  if (!section || !refined.trim() || /##[ \t]*Bottleneck[ \t]*\n/i.test(refined)) return refined;
  return `${refined.replace(/\s+$/, "")}\n\n${section}`;
}

export interface AssistantEodDraftResponse {
  markdown: string;
  model: string;
  clockedOut?: boolean;
  screenshotSyncUnavailable?: boolean;
  screenshots?: {
    processed: number;
    excluded: number;
    failed: number;
    pending: number;
    hours: Array<{ hourStart: number; label: string; summary: string; frameCount: number }>;
  };
  loom?: { title: string | null; verdict: string } | null;
}

/** One bounded screenshot preparation round before drafting, exactly like the
 * companion's first round (the multi-round waiting state stays companion-only;
 * the evidence panel keeps the manual analyze action for more rounds). */
export async function prepareOneScreenshotRound(date: string): Promise<void> {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 45_000) : null;
  try {
    await fetch("/api/work-os/me/eod/screenshots/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, max_frames: 6 }),
      signal: controller?.signal,
    });
  } catch {
    // Preparation is best-effort: drafting proceeds from whatever is analyzed.
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Copy for the assistant-draft receipt, naming exactly what changed. */
export function assistantDraftNotice(response: AssistantEodDraftResponse): string {
  const pieces = ["Assistant draft ready — review every line."];
  const processed = response.screenshots?.processed ?? 0;
  if (processed > 0) pieces.push(`${processed} analyzed screenshot${processed === 1 ? "" : "s"} grounded it.`);
  if (response.screenshotSyncUnavailable) pieces.push("Screenshot context was unavailable for this draft.");
  return pieces.join(" ");
}

export function assistantDraftFallbackNotice(gated: boolean, message: string): string {
  return gated
    ? message
    : `The assistant is unavailable — showing the standard draft. ${message}`.trim();
}

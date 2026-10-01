/** EOD drafting helpers shared with the companion's flow.
 *
 * The assistant draft is the default on both surfaces: the standard report
 * record is created first, then the AI narrative replaces the placeholder —
 * and a gated or unavailable assistant keeps the standard draft honest. */

/** The refine request must not let the assistant rewrite the bottleneck
 * answer the employee owns, so that section is stripped before sending. */
export function stripBottleneckSection(markdown: string): string {
  return markdown.replace(/\n+##\s*Bottleneck[\s\S]*$/i, "").replace(/\s+$/, "");
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

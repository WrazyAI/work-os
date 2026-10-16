import type { Json } from "@/lib/work-os-internal";
import { withinEodActivityWindow, type EodActivityWindow } from "@/lib/work-os-eod-window";

/** Scheduled agent routines ("Run me-context-update routine (2026-09-17)") are
 * automation, not employee deliverables. The EOD collapses every run of the
 * same routine into one line instead of listing each execution. The generated
 * routines always carry a date suffix, which keeps titles a person might write
 * ("Run the weekly routine") out of the automation bucket. */
const AUTOMATION_TITLE_RE = /^run\s+(.+?)\s+routine\s*(?:\(|—|–|-)/i;

export function automationName(title: string): string | null {
  const match = String(title ?? "").trim().match(AUTOMATION_TITLE_RE);
  if (!match) return null;
  const name = match[1].trim().replace(/\s+/g, " ");
  return name || "agent routine";
}

export function isAutomationTitle(title: string): boolean {
  return automationName(title) !== null;
}

export type EodFactLine = { id: string; title: string; at: string | null; provenance: string | null };

/** Collapses routine runs into a single summary line, most frequent first. */
export function collapseAutomation(lines: Array<{ title: string } | string>): { count: number; line: string | null } {
  const groups = new Map<string, number>();
  for (const line of lines) {
    const name = automationName(typeof line === "string" ? line : line.title);
    if (!name) continue;
    groups.set(name, (groups.get(name) ?? 0) + 1);
  }
  if (!groups.size) return { count: 0, line: null };
  const parts = [...groups.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => `${name} ×${count}`);
  const total = [...groups.values()].reduce((sum, count) => sum + count, 0);
  return { count: total, line: `- Automation runs (${total}): ${parts.join(", ")}` };
}

/** Clips at a word boundary with an explicit ellipsis, so a truncated
 * observation never ends mid-word without signalling the cut. */
export function clipText(value: unknown, max = 180): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}

/** "3:04 PM" in the employee's timezone, or null when the instant is unusable.
 * Never includes a timezone name or offset. */
export function formatLocalTime(value: unknown, timezone: string): string | null {
  const at = value instanceof Date ? value : new Date(String(value ?? ""));
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "UTC",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
}

/** "September 17, 2026" for a YYYY-MM-DD report date. */
export function formatReportDate(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return date;
  return at.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" });
}

export function humanizeGoalSource(provenance: unknown): string {
  const key = typeof provenance === "string" ? provenance.trim() : "";
  const labels: Record<string, string> = {
    ai_draft: "AI draft",
    employee: "Employee",
    accepted_suggestion: "Accepted suggestion",
  };
  return labels[key] ?? "Not recorded";
}

/** The label for facts outside the window. A scheduled shift says "outside
 * shift"; a session-derived window (no schedule that day) says "outside the
 * workday" rather than implying a shift that does not exist. */
export function outsideWindowLabel(window: EodActivityWindow | null): string {
  if (!window) return "";
  return window.source === "schedule" ? " (outside shift)" : " (outside the workday)";
}

/** Facts the workday window proves finished outside it carry a plain marker,
 * so a manager never reads off-shift work as in-shift work. Facts with no
 * window or no usable timestamp stay unmarked. */
export function outsideShiftMarker(at: unknown, window: EodActivityWindow | null): string {
  return window && !withinEodActivityWindow(at, window) ? outsideWindowLabel(window) : "";
}

/** One report line: "- Title — 09:12", with the time only when it is known and
 * the outside-shift marker when the workday window proves it. */
export function factLine(item: { title: string; at?: string | null }, timezone: string, verb?: string, window?: EodActivityWindow | null): string {
  const time = formatLocalTime(item.at, timezone);
  const suffix = time ? ` — ${verb ? `${verb} ` : ""}${time}` : "";
  return `- ${item.title}${suffix}${outsideShiftMarker(item.at, window ?? null)}`;
}

/** Creations that came from the day's own plan are commitments, not unplanned
 * work. Creations that were completed the same day are already reported under
 * Completed Work, so this section carries the day's open emergent additions. */
export function unplannedFacts(events: Json[], planTaskIds: Set<string>, timezone: string): EodFactLine[] {
  const completedTaskIds = new Set<string>();
  for (const event of events) {
    if (String(event.event_type ?? "") === "completed") completedTaskIds.add(String(event.task_id ?? ""));
  }
  const byTask = new Map<string, EodFactLine>();
  for (const event of events) {
    if (String(event.event_type ?? "") !== "creation_observed") continue;
    const title = String((event.task_snapshot as { title?: unknown } | null)?.title ?? "").trim();
    if (!title || isAutomationTitle(title)) continue;
    const taskId = String(event.task_id ?? event.id ?? "");
    if (!taskId || planTaskIds.has(taskId) || completedTaskIds.has(taskId)) continue;
    const at = event.exact_at instanceof Date ? event.exact_at.toISOString() : (typeof event.exact_at === "string" ? event.exact_at : null);
    const existing = byTask.get(taskId);
    if (!existing || (!existing.at && at)) byTask.set(taskId, { id: taskId, title, at, provenance: null });
  }
  return [...byTask.values()].sort((left, right) => String(left.at ?? "").localeCompare(String(right.at ?? "")));
}

/** Substantive updates that describe progress (blockers and unplanned notes
 * are reported elsewhere). */
export function progressedFacts(updates: Json[], timezone: string): EodFactLine[] {
  const lines: EodFactLine[] = [];
  for (const [index, update] of updates.entries()) {
    if (["blocked", "unplanned_work"].includes(String(update.update_kind ?? ""))) continue;
    const text = String(update.input_text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const at = update.occurred_at instanceof Date ? update.occurred_at.toISOString() : (typeof update.occurred_at === "string" ? update.occurred_at : null);
    lines.push({ id: String(update.id ?? `update:${index}`), title: clipText(text, 400), at, provenance: null });
  }
  // An unusable timestamp must not silently drop the update; it only drops the
  // time suffix. Undated updates sort last.
  return lines.sort((left, right) => String(left.at ?? "9999").localeCompare(String(right.at ?? "9999")));
}

export type ActivityGroup = {
  app: string;
  count: number;
  firstAt: string;
  lastAt: string;
  highlights: string[];
};

/** Groups a day's viewable frames by visible app so the report shows a handful
 * of labelled groups instead of one line per frame. */
export function groupActivityFrames(
  frames: Array<{ capturedAt: string; visibleApp: string | null; summary: string }>,
  limit = 6,
): ActivityGroup[] {
  const byApp = new Map<string, Array<{ capturedAt: string; summary: string }>>();
  for (const frame of frames) {
    const app = (frame.visibleApp ?? "").trim() || "Unclear context";
    const list = byApp.get(app) ?? [];
    list.push({ capturedAt: String(frame.capturedAt ?? ""), summary: String(frame.summary ?? "").trim() });
    byApp.set(app, list);
  }
  return [...byApp.entries()]
    .map(([app, list]) => {
      const sorted = [...list].sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
      return {
        app,
        count: sorted.length,
        firstAt: sorted[0]?.capturedAt ?? "",
        lastAt: sorted[sorted.length - 1]?.capturedAt ?? "",
        highlights: sorted.map((frame) => clipText(frame.summary, 140)).filter(Boolean).slice(0, 2),
      };
    })
    .sort((left, right) => right.count - left.count || left.firstAt.localeCompare(right.firstAt))
    .slice(0, Math.max(1, limit));
}

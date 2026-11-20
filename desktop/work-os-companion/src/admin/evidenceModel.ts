import {
  evidenceKind,
  type EvidenceKind,
} from "../../../../src/modules/work-os/evidence-kinds";
import { one, type EvidenceCoverage, type EvidenceRow, type EvidenceSummary } from "./types";

export type EvidenceTone = "observed" | "quiet" | "warn" | "danger";
export type EvidenceDirection = "inbound" | "outbound" | null;

export type EvidenceEntry =
  | { type: "group"; key: string; hour: number; direction: EvidenceDirection; rows: EvidenceRow[]; sortMs: number }
  | { type: "event"; row: EvidenceRow; sortMs: number };

export type EvidenceScreenshot = {
  id: string;
  processing_status: string;
  summary: string | null;
  confidence: number | null;
  storage_path: string | null;
  deleted_at: string | null;
  previewUrl?: string | null;
};

export function evidenceScreenshot(row: EvidenceRow): EvidenceScreenshot | null {
  return one<EvidenceScreenshot>(row.event?.screenshot);
}

export type CoverageRow = {
  key: string;
  personId: string | null;
  name: string;
  note: string;
  days: Map<string, { count: number; emails: number }>;
  total: number;
  emails: number;
};

const STATUS_TONES: Record<string, EvidenceTone> = {
  completed: "observed",
  sent: "observed",
  success: "observed",
  merged: "observed",
  opened: "observed",
  pushed: "observed",
  reviewed: "observed",
  observed: "observed",
  "no answer": "quiet",
  voicemail: "quiet",
  received: "quiet",
  open: "quiet",
  closed: "quiet",
  recorded: "quiet",
  busy: "warn",
  failed: "danger",
  failure: "danger",
  lost: "danger",
};

const STATUS_PLURALS: Record<string, string> = {
  "no answer": "no answers",
  voicemail: "voicemails",
  success: "successes",
  failure: "failures",
  completed: "completed",
  busy: "busy",
  failed: "failed",
  sent: "sent",
  open: "open",
  merged: "merged",
  opened: "opened",
  pushed: "pushed",
  reviewed: "reviewed",
  observed: "observed",
};

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

export function evidenceOccurrence(row: EvidenceRow): string {
  const value = row.recorded_at || row.created_at || "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

export function evidenceShortDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function evidenceTime(row: EvidenceRow): string {
  const occurrence = evidenceOccurrence(row);
  if (!occurrence) return "—";
  return new Date(occurrence).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function evidenceDate(row: EvidenceRow): string {
  const recorded = String(row.evidence_date ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(recorded)) return recorded;
  const occurrence = evidenceOccurrence(row);
  return occurrence ? occurrence.slice(0, 10) : "Unknown";
}

export function evidenceKindOf(row: EvidenceRow): EvidenceKind {
  return evidenceKind(row.source, row.title);
}

export function evidenceDirection(row: EvidenceRow): EvidenceDirection {
  const title = String(row.title ?? "").toLowerCase();
  const summary = String(row.summary ?? "").toLowerCase();
  if (title.includes("call inbound") || summary.includes("call inbound")) return "inbound";
  if (title.includes("call outbound") || summary.includes("call outbound")) return "outbound";
  return null;
}

export function evidenceStatus(row: EvidenceRow): { label: string; tone: EvidenceTone } {
  const kind = evidenceKindOf(row);
  const title = String(row.title ?? "").toLowerCase();
  const summary = String(row.summary ?? "").toLowerCase();
  if (kind === "call") {
    const match = summary.match(/status\s+([a-z-]+)/i) ?? title.match(/status\s+([a-z-]+)/i);
    const value = match?.[1]?.toLowerCase();
    if (value) {
      const label = capitalize(value.replaceAll("_", " ").replaceAll("-", " "));
      return { label, tone: STATUS_TONES[label.toLowerCase()] ?? "quiet" };
    }
    return { label: "Recorded", tone: "quiet" };
  }
  if (kind === "email" || kind === "text") {
    if (title.includes("received") || summary.includes("received")) return { label: "Received", tone: "quiet" };
    if (title.includes("sent") || summary.includes("sent")) return { label: "Sent", tone: "observed" };
    return { label: "Recorded", tone: "quiet" };
  }
  if (kind === "context") {
    if (title.includes("won") || summary.includes("won")) return { label: "Won", tone: "observed" };
    if (title.includes("lost") || summary.includes("lost")) return { label: "Lost", tone: "danger" };
    return { label: title.includes("open") || summary.includes("open") ? "Open" : "Recorded", tone: "quiet" };
  }
  if (kind === "github") {
    if (title.startsWith("workflow success")) return { label: "Success", tone: "observed" };
    if (title.startsWith("workflow failure")) return { label: "Failure", tone: "danger" };
    if (title.startsWith("pull request opened") || title.startsWith("issue opened")) return { label: "Opened", tone: "observed" };
    if (title.startsWith("pull request merged")) return { label: "Merged", tone: "observed" };
    if (title.startsWith("pull request closed") || title.startsWith("issue closed")) return { label: "Closed", tone: "quiet" };
    if (title.startsWith("pushed ")) return { label: "Pushed", tone: "observed" };
    if (title.startsWith("review submitted")) return { label: "Reviewed", tone: "observed" };
    return { label: "Recorded", tone: "quiet" };
  }
  if (kind === "worktivity") return { label: "Observed", tone: "observed" };
  return { label: "Recorded", tone: "quiet" };
}

export function evidenceDuration(row: EvidenceRow): string | null {
  const metadata = row.event?.metadata;
  const ghl = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).ghl : null;
  const seconds = ghl && typeof ghl === "object" ? Number((ghl as Record<string, unknown>).durationSeconds) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${rest}s`;
  return `${rest}s`;
}

export function evidencePerson(row: EvidenceRow): { name: string; note: string; tone: "actor" | "context" | "unknown" } {
  if (row.person?.display_name) {
    return {
      name: row.person.display_name,
      note: row.source === "github" ? "GitHub account" : row.source === "worktivity" ? "Observed" : "Actor",
      tone: "actor",
    };
  }
  const ghl = row.ghl;
  if (row.source === "ghl" && ghl?.relation === "automation") {
    return { name: "Automation", note: "Not the employee", tone: "unknown" };
  }
  if (row.source === "ghl" && ghl?.relation === "shared_account") {
    return { name: "Shared account", note: "Not one employee", tone: "unknown" };
  }
  if (row.source === "ghl" && ghl?.assigneeLabels?.length) {
    return { name: ghl.assigneeLabels.join(", "), note: "Assigned only", tone: "context" };
  }
  if (row.source === "ghl" && ghl?.actorLabel) {
    return { name: ghl.actorLabel, note: "Not attributed", tone: "unknown" };
  }
  return { name: "Unmapped person", note: "No person mapping", tone: "unknown" };
}

/** Linked GHL evidence comes through `work_evidence` without the projected
 * `ghl` block; its provider relation still lives in the event metadata. A
 * linked row with a person is a performed action, never an unknown actor. */
export function evidenceGhlRelation(row: EvidenceRow): string | null {
  if (row.ghl?.relation) return row.ghl.relation;
  const metadata = row.event?.metadata;
  const ghl = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).ghl : null;
  const relation = ghl && typeof ghl === "object" ? (ghl as Record<string, unknown>).relation : null;
  if (typeof relation === "string" && relation) return relation;
  if (row.source === "ghl" && row.person?.id) return "performed";
  return null;
}

export function evidenceActor(row: EvidenceRow): string {
  if (row.source !== "ghl") return row.person?.display_name ?? "Unmapped person";
  const relation = evidenceGhlRelation(row);
  if (relation === "assigned_only" || relation === "unknown") return row.ghl?.actorLabel ?? "Actor unknown";
  if (relation === "automation" || relation === "shared_account") return row.ghl?.actorLabel ?? capitalize(relation);
  if (relation === "performed" && row.person?.display_name) return row.person.display_name;
  return row.ghl?.actorLabel ?? row.person?.display_name ?? "Actor unknown";
}

export function evidenceAssignee(row: EvidenceRow): string | null {
  return row.ghl?.assigneeLabels?.length ? row.ghl.assigneeLabels.join(", ") : null;
}

export function evidenceAutomation(row: EvidenceRow): boolean {
  return evidenceGhlRelation(row) === "automation";
}

export function evidenceRelationLabel(row: EvidenceRow): string {
  const relation = evidenceGhlRelation(row);
  if (relation === "performed") return "Performed by actor";
  if (relation === "automation") return "Automation";
  if (relation === "shared_account") return "Shared account";
  if (relation === "assigned_only") return "Assigned only";
  if (relation === "observed") return "Observed";
  return "Actor unknown";
}

export function evidenceWhoNote(row: EvidenceRow): string {
  if (evidenceKindOf(row) === "call" && evidenceDirection(row) === "inbound" && evidenceActor(row) === "Actor unknown") {
    return "The provider recorded an inbound action but named no person. It is not credited to the contact owner.";
  }
  if (evidenceGhlRelation(row) === "assigned_only") {
    return "Assigned only. The workspace shows the owner as context and does not credit the action to them.";
  }
  if (evidenceGhlRelation(row) === "automation") return "Automation is never credited to an employee.";
  if (row.source === "github") return "The GitHub account is mapped to this person. The event is attributed to that account, not to a task completion.";
  if (row.source === "worktivity") return "Observed device activity. A frame does not establish what the person was thinking, completing, or intending.";
  return "The actor is who the provider says performed it. Ownership is context, never proof of an action.";
}

export function evidenceContentLabel(row: EvidenceRow): string {
  if (row.ghl?.contentAvailability === "available") return "Body available in GoHighLevel";
  if (row.ghl?.contentAvailability === "on_demand") return "Body available on demand in GoHighLevel";
  if (row.source === "worktivity") return "Private retained frame";
  return "Metadata only";
}

export function evidenceStatusMix(rows: EvidenceRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = evidenceStatus(row).label;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const entries = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const shown = entries.slice(0, 3).map(([label, count]) => {
    const lower = label.toLowerCase();
    const plural = count === 1 ? lower : STATUS_PLURALS[lower] ?? `${lower}s`;
    return `${count} ${plural}`;
  });
  if (entries.length > 3) shown.push(`+${entries.slice(3).reduce((sum, [, count]) => sum + count, 0)} more`);
  return shown.join(" · ");
}

export function evidenceGroupStatus(rows: EvidenceRow[]): { label: string; count: number; tone: EvidenceTone } {
  const counts = new Map<string, { count: number; tone: EvidenceTone }>();
  for (const row of rows) {
    const status = evidenceStatus(row);
    const current = counts.get(status.label) ?? { count: 0, tone: status.tone };
    current.count += 1;
    counts.set(status.label, current);
  }
  const [label, value] = [...counts.entries()].sort((left, right) => right[1].count - left[1].count)[0];
  return { label, count: value.count, tone: value.tone };
}

export function groupEvidenceDays(rows: EvidenceRow[]): Array<{ date: string; rows: EvidenceRow[] }> {
  const days = new Map<string, EvidenceRow[]>();
  for (const row of rows) {
    const date = evidenceDate(row);
    const list = days.get(date) ?? [];
    list.push(row);
    days.set(date, list);
  }
  return [...days.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([date, dayRows]) => ({ date, rows: dayRows }));
}

function occurrenceMs(row: EvidenceRow) {
  const occurrence = evidenceOccurrence(row);
  if (!occurrence) return 0;
  const value = new Date(occurrence).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function groupEvidenceEntries(date: string, rows: EvidenceRow[]): EvidenceEntry[] {
  const groups = new Map<string, { hour: number; direction: EvidenceDirection; rows: EvidenceRow[] }>();
  const entries: EvidenceEntry[] = [];
  for (const row of rows) {
    if (evidenceKindOf(row) !== "call") {
      entries.push({ type: "event", row, sortMs: occurrenceMs(row) });
      continue;
    }
    const occurrence = evidenceOccurrence(row);
    const hour = occurrence ? new Date(occurrence).getHours() : 0;
    const direction = evidenceDirection(row);
    const key = `${date}-${hour}-${direction ?? "unknown"}`;
    const group = groups.get(key) ?? { hour, direction, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  for (const [key, group] of groups) {
    const sortMs = Math.min(...group.rows.map(occurrenceMs));
    entries.push({ type: "group", key, hour: group.hour, direction: group.direction, rows: group.rows, sortMs });
  }
  return entries.sort((left, right) => left.sortMs - right.sortMs);
}

export function coverageLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count < 10) return 1;
  if (count < 50) return 2;
  if (count < 100) return 3;
  return 4;
}

export function buildDateRange(from: string, to: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return [];
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let guard = 0; guard < 92 && cursor <= end; guard += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function buildCoverageRows(
  summary: EvidenceSummary | undefined,
  people: Array<{ id: string; display_name: string }>,
  dates: string[],
): CoverageRow[] {
  const coverage: EvidenceCoverage | undefined = summary?.coverage;
  if (!coverage?.people?.length) return [];
  const names = new Map(people.map((person) => [person.id, person.display_name]));
  const rows = coverage.people.map((entry) => {
    const days = new Map<string, { count: number; emails: number }>();
    for (const day of entry.days) {
      if (dates.includes(day.date)) days.set(day.date, { count: day.count, emails: day.emails });
    }
    const values = [...days.values()];
    return {
      key: entry.personId ?? "uncredited",
      personId: entry.personId,
      name: entry.personId ? names.get(entry.personId) ?? "Unmapped person" : "Not employee work",
      note: entry.personId ? "Person" : "Unknown, assigned, automation",
      days,
      total: values.reduce((sum, value) => sum + value.count, 0),
      emails: values.reduce((sum, value) => sum + value.emails, 0),
    } satisfies CoverageRow;
  });
  return rows.sort((left, right) => {
    if (left.personId === null) return 1;
    if (right.personId === null) return -1;
    return right.total - left.total || left.name.localeCompare(right.name);
  });
}

export function coverageCell(row: CoverageRow, date: string) {
  return row.days.get(date) ?? { count: 0, emails: 0 };
}

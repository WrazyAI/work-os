import { useState } from "react";
import {
  Briefcase,
  Camera,
  ChevronRight,
  GitBranch,
  GitPullRequest,
  Mail,
  MessageSquare,
  Phone,
  PhoneIncoming,
  Search,
  Workflow,
} from "lucide-react";
import { ScreenshotImage } from "../ScreenshotGallery";
import { formatWorkOsFullDate } from "../dateFormat";
import { Notice, Skeleton } from "./ui";
import {
  evidenceAssignee,
  evidenceContentLabel,
  evidenceDirection,
  evidenceDuration,
  evidenceGroupStatus,
  evidenceKindOf,
  evidenceOccurrence,
  evidencePerson,
  evidenceScreenshot,
  evidenceStatus,
  evidenceStatusMix,
  evidenceTime,
  groupEvidenceDays,
  groupEvidenceEntries,
} from "./evidenceModel";
import type { EvidenceRow } from "./types";

function sourceLabel(source: string) {
  if (source === "ghl") return "GoHighLevel";
  if (source === "github") return "GitHub";
  if (source === "worktivity") return "Worktivity";
  if (source === "loom") return "Loom";
  if (source === "nifty") return "Legacy import";
  return source;
}

function hourLabel(hour: number) {
  return new Date(2000, 0, 1, hour, 0).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function iconFor(row: EvidenceRow) {
  const kind = evidenceKindOf(row);
  if (kind === "call") return evidenceDirection(row) === "inbound" ? PhoneIncoming : Phone;
  if (kind === "email") return Mail;
  if (kind === "text") return MessageSquare;
  if (kind === "context") return Briefcase;
  if (kind === "worktivity") return Camera;
  if (kind === "github") {
    const title = row.title.toLowerCase();
    if (title.includes("pull request")) return GitPullRequest;
    if (title.includes("pushed")) return GitBranch;
    return Workflow;
  }
  return Search;
}

function subtitleFor(row: EvidenceRow) {
  const kind = evidenceKindOf(row);
  const status = evidenceStatus(row);
  if (kind === "call") {
    const direction = evidenceDirection(row) === "inbound" ? "Inbound" : "Outbound";
    return [direction, status.label, evidenceDuration(row)].filter(Boolean).join(" · ");
  }
  if (kind === "email") return `Recorded by GoHighLevel · ${evidenceContentLabel(row)}`;
  if (kind === "text") return `Text message · ${status.label}`;
  if (kind === "context") {
    const assigned = evidenceAssignee(row);
    return assigned ? `Assigned-only context · ${assigned}` : "Contextual provider record";
  }
  return row.summary || status.label;
}

export default function EvidenceLedger({
  rows,
  onSelect,
  thumbnailIds,
  loading = false,
  error = null,
  emptyTitle = "No evidence matches these filters",
  emptyBody = "Clear the source or kind filter, or widen the date range. The record only shows what a provider actually recorded.",
  onClearFilters,
}: {
  rows: EvidenceRow[];
  onSelect: (row: EvidenceRow) => void;
  thumbnailIds: Set<string>;
  loading?: boolean;
  error?: Error | null;
  emptyTitle?: string;
  emptyBody?: string;
  onClearFilters?: () => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  if (loading) {
    return (
      <div className="evidence-ledger" aria-busy="true">
        <div className="evidence-loading"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div>
      </div>
    );
  }
  if (error) {
    return <div className="evidence-ledger"><div className="evidence-loading"><Notice tone="err">{error.message}</Notice></div></div>;
  }
  if (!rows.length) {
    return (
      <div className="evidence-ledger">
        <div className="evidence-empty">
          <span className="evidence-empty-icon"><Search size={17} aria-hidden /></span>
          <h3>{emptyTitle}</h3>
          <p>{emptyBody}</p>
          {onClearFilters ? <button type="button" className="admin-button" onClick={onClearFilters}>Clear filters</button> : null}
        </div>
      </div>
    );
  }

  const days = groupEvidenceDays(rows);
  return (
    <div className="evidence-ledger">
      {days.map((day) => {
        const entries = groupEvidenceEntries(day.date, day.rows);
        const emails = day.rows.filter((row) => evidenceKindOf(row) === "email").length;
        return (
          <section key={day.date} className="evidence-day">
            <div className="evidence-day-head">
              <h3>{formatWorkOsFullDate(day.date)}</h3>
              <span>{day.rows.length} record{day.rows.length === 1 ? "" : "s"}</span>
              {emails ? <span className="evidence-day-email"><Mail size={11} aria-hidden /> {emails} email{emails === 1 ? "" : "s"}</span> : null}
            </div>
            {entries.map((entry) => {
              if (entry.type === "event") {
                return <EvidenceRowButton key={entry.row.id} row={entry.row} onSelect={onSelect} thumbnailIds={thumbnailIds} />;
              }
              const open = expanded.has(entry.key);
              const groupStatus = evidenceGroupStatus(entry.rows);
              const person = evidencePerson(entry.rows[0]);
              const direction = entry.direction === "inbound" ? "inbound" : "outbound";
              return (
                <div key={entry.key} className="evidence-group-wrap">
                  <button
                    type="button"
                    className={`evidence-row evidence-group${open ? " is-open" : ""}`}
                    aria-expanded={open}
                    onClick={() => setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(entry.key)) next.delete(entry.key);
                      else next.add(entry.key);
                      return next;
                    })}
                  >
                    <span className="evidence-time">{hourLabel(entry.hour)}</span>
                    <span className="evidence-kind-tile">{entry.direction === "inbound" ? <PhoneIncoming size={14} aria-hidden /> : <Phone size={14} aria-hidden />}</span>
                    <span className="evidence-main">
                      <span className="evidence-title">{entry.rows.length} {direction} call{entry.rows.length === 1 ? "" : "s"}</span>
                      <span className="evidence-sub">{evidenceStatusMix(entry.rows)}</span>
                    </span>
                    <span className="evidence-person"><b>{person.name}</b><small className={person.tone === "context" ? "is-context" : person.tone === "unknown" ? "is-unknown" : ""}>{person.note}</small></span>
                    <span className={`evidence-status is-${groupStatus.tone}`}><i />{groupStatus.label} {groupStatus.count}</span>
                    <span className="evidence-source">{sourceLabel(entry.rows[0].source)}</span>
                    <ChevronRight size={13} className={open ? "evidence-chevron is-open" : "evidence-chevron"} aria-hidden />
                  </button>
                  {open ? entry.rows.map((row) => <EvidenceRowButton key={row.id} row={row} onSelect={onSelect} thumbnailIds={thumbnailIds} expanded />) : null}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function EvidenceRowButton({
  row,
  onSelect,
  thumbnailIds,
  expanded = false,
}: {
  row: EvidenceRow;
  onSelect: (row: EvidenceRow) => void;
  thumbnailIds: Set<string>;
  expanded?: boolean;
}) {
  const kind = evidenceKindOf(row);
  const status = evidenceStatus(row);
  const person = evidencePerson(row);
  const shot = evidenceScreenshot(row);
  const Icon = iconFor(row);
  const showThumb = kind === "worktivity" && shot?.id && !shot.deleted_at && thumbnailIds.has(shot.id);
  return (
    <button
      type="button"
      className={`evidence-row${expanded ? " is-call-row" : ""}${row.event?.correction_status === "disputed" ? " is-disputed" : ""}`}
      onClick={() => onSelect(row)}
    >
      <time className="evidence-time" dateTime={evidenceOccurrence(row) || undefined}>{evidenceTime(row)}</time>
      <span className={`evidence-kind-tile is-${kind}`}>
        {showThumb && shot?.id ? (
          <ScreenshotImage summaryId={shot.id} size="thumb" alt={`Retained Worktivity frame for ${person.name}`} className="evidence-thumb" unavailableLabel="Private" />
        ) : <Icon size={expanded ? 12 : 14} aria-hidden />}
      </span>
      <span className="evidence-main">
        <span className="evidence-title">{row.title}</span>
        <span className="evidence-sub">{subtitleFor(row)}</span>
      </span>
      <span className="evidence-person"><b>{person.name}</b><small className={person.tone === "context" ? "is-context" : person.tone === "unknown" ? "is-unknown" : ""}>{person.note}</small></span>
      <span className={`evidence-status is-${status.tone}`}><i />{status.label}</span>
      <span className="evidence-source">{sourceLabel(row.source)}</span>
      <ChevronRight size={13} className="evidence-chevron" aria-hidden />
    </button>
  );
}

import {
  Activity,
  Camera,
  CheckCircle2,
  FileCheck2,
  ListChecks,
  MessageSquareText,
  Users,
} from "lucide-react";
import { formatWorkOsFullDate } from "../dateFormat";
import { relativeTime, statusLabel } from "./data";
import type { AdminOverviewActivity, AdminSection, AdminSectionFocus } from "./types";
import { AdminButton, Avatar, Drawer, KeyValue, Pill } from "./ui";

/** One activity or update record as the detail drawer shows it.
 *
 * The Overview activity stream and a person's recorded updates arrive in
 * different shapes; both normalize into this record so one surface renders
 * either and never echoes raw API field names. Every field is optional on
 * purpose: the workspace is live-data driven, so a sparse row degrades to
 * honest fallback copy instead of "undefined". */
export interface ActivityDetailRecord {
  id: string;
  kind: string;
  at: string | null;
  personId: string | null;
  personName: string | null;
  title: string;
  detail: string | null;
  provenance: string | null;
  /** Reference instant relative times are read against. The Overview reads
   * the record as of its snapshot (`generatedAt`) so the detail agrees with
   * the row that opened it. */
  asOf?: number;
  /** Recorded facts beyond the core row (update kind, workday, …). */
  facts?: Array<{ label: string; value: string }>;
  /** The day's EOD report, when the record's day has one on file. */
  reportId?: string | null;
}

const KIND_LABELS: Record<string, string> = {
  update: "Update",
  recap: "Activity recap",
  task_completed: "Completed task",
  evidence: "Evidence",
  eod_submitted: "EOD submission",
};

export function activityKindLabel(kind: string | null | undefined) {
  const key = String(kind ?? "").trim();
  return KIND_LABELS[key] ?? (key ? statusLabel(key) : "Activity");
}

export function activityKindIcon(kind: string | null | undefined) {
  if (kind === "task_completed") return CheckCircle2;
  if (kind === "evidence") return Camera;
  if (kind === "eod_submitted") return FileCheck2;
  if (kind === "recap") return Activity;
  return MessageSquareText;
}

function activityKindTone(kind: string): "ok" | "observed" | "info" | "neutral" {
  if (kind === "task_completed") return "ok";
  if (kind === "evidence") return "observed";
  if (kind === "eod_submitted") return "info";
  return "neutral";
}

/** The one "go look at this" action a kind implies. Updates carry no section
 * destination of their own, so they return null rather than a fake action. */
export function activitySectionAction(kind: string): { label: string; section: AdminSection; focus?: AdminSectionFocus; icon: typeof Activity } | null {
  if (kind === "task_completed") return { label: "Open tasks", section: "tasks", icon: ListChecks };
  if (kind === "evidence") return { label: "Open evidence", section: "evidence", icon: Camera };
  if (kind === "eod_submitted") return { label: "Open EOD review", section: "review", icon: FileCheck2 };
  if (kind === "recap") return { label: "Open activity recaps", section: "evidence", focus: { evidenceTab: "recaps" }, icon: Activity };
  return null;
}

/** The full text a check-in row recorded, across the shapes the API and its
 * legacy payloads use. Empty and whitespace-only values fall through. */
export function updateText(update: Record<string, any>) {
  for (const value of [update.input_text, update.summary, update.update_text, update.text]) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return null;
}

const UPDATE_TITLES: Record<string, string> = {
  progress: "Progress update",
  completion_claim: "Completion claim",
  blocked: "Blocker raised",
  priority_change: "Priority change",
  unplanned_work: "Unplanned work",
};

export function activityRecordFromOverview(item: AdminOverviewActivity, asOf?: number): ActivityDetailRecord {
  const title = String(item.title ?? "").trim();
  return {
    id: item.id,
    kind: item.kind,
    at: item.at || null,
    personId: item.personId ?? null,
    personName: item.personName ?? null,
    title: title || activityKindLabel(item.kind),
    detail: String(item.detail ?? "").trim() || null,
    provenance: item.provenance ?? null,
    asOf: Number.isFinite(asOf) ? asOf : undefined,
  };
}

export function activityRecordFromUpdate(
  update: Record<string, any>,
  person: { id: string; name: string | null },
  reportId?: string | null,
): ActivityDetailRecord {
  const kind = String(update.update_kind ?? update.kind ?? "update");
  const substantive = update.substantive === true;
  const at = String(update.occurred_at ?? update.created_at ?? "").trim() || null;
  const facts: Array<{ label: string; value: string }> = [
    { label: "Update kind", value: statusLabel(kind) },
    { label: "Substantive", value: substantive ? "Yes — recorded as progress" : "No — routine check-in" },
  ];
  if (update.shift_date) facts.push({ label: "Workday", value: formatWorkOsFullDate(update.shift_date) });
  return {
    id: `update:${String(update.id ?? at ?? "record")}`,
    kind: "update",
    at,
    personId: person.id,
    personName: person.name,
    title: UPDATE_TITLES[kind] ?? (substantive ? "Progress update" : "Check-in"),
    detail: updateText(update),
    provenance: "employee",
    facts,
    reportId: reportId ?? null,
  };
}

/** Full-record detail for one activity or update item. Read-only: every action
 * either opens the person's record or navigates to the section that owns the
 * record's kind, and actions with no honest destination are simply omitted. */
export function ActivityDetailDrawer({ record, onClose, onOpenPerson, onOpenSection, onOpenReport }: {
  record: ActivityDetailRecord | null;
  onClose: () => void;
  onOpenPerson?: (personId: string) => void;
  onOpenSection?: (section: AdminSection, focus?: AdminSectionFocus) => void;
  onOpenReport?: (reportId: string) => void;
}) {
  const Icon = activityKindIcon(record?.kind);
  const sectionAction = record ? activitySectionAction(record.kind) : null;
  const personName = record
    ? String(record.personName ?? "").trim() || (record.personId ? "Unmapped person" : "Workspace")
    : "Workspace";
  const actions = [];
  if (record?.personId && onOpenPerson) {
    actions.push(
      <AdminButton key="person" icon={Users} onClick={() => onOpenPerson(record.personId!)}>
        {record.personName ? `Open ${record.personName}` : "Open person"}
      </AdminButton>,
    );
  }
  if (record?.reportId && onOpenReport && sectionAction?.section !== "review") {
    actions.push(
      <AdminButton key="report" icon={FileCheck2} onClick={() => onOpenReport(record.reportId!)}>
        Open EOD review
      </AdminButton>,
    );
  }
  if (sectionAction && onOpenSection) {
    const SectionIcon = sectionAction.icon;
    actions.push(
      <AdminButton key="section" icon={SectionIcon} onClick={() => onOpenSection(sectionAction.section, sectionAction.focus)}>
        {sectionAction.label}
      </AdminButton>,
    );
  }
  const readAt = record?.asOf;

  return (
    <Drawer
      open={!!record}
      onClose={onClose}
      title={record?.title || "Activity"}
      subtitle={record ? `${personName} · record ${relativeTime(record.at, readAt)}` : undefined}
      width={480}
      footer={actions.length ? <div className="admin-decision-actions">{actions}</div> : undefined}
    >
      {record ? (
        <div className="admin-grid admin-drawer-grid">
          <div className="admin-chips">
            <Pill tone={activityKindTone(record.kind)} icon={Icon}>{activityKindLabel(record.kind)}</Pill>
            {record.provenance ? <Pill tone="neutral">Provenance: {statusLabel(record.provenance)}</Pill> : null}
          </div>

          <section className="admin-block">
            <div className="admin-activity-person">
              <Avatar name={personName} size={34} />
              <span className="min-w-0">
                <b>{personName}</b>
                <small>Recorded {relativeTime(record.at, readAt)}</small>
              </span>
            </div>
            {record.detail ? (
              <p className="admin-activity-detail-text">{record.detail}</p>
            ) : (
              <p className="admin-empty-note">No further detail was recorded for this item.</p>
            )}
          </section>

          <section className="admin-block">
            <h3>Record</h3>
            <div className="admin-kv-grid">
              <KeyValue label="Kind" value={activityKindLabel(record.kind)} />
              <KeyValue label="Recorded" value={relativeTime(record.at, readAt)} />
              <KeyValue label="Person" value={personName} />
              <KeyValue label="Provenance" value={record.provenance ? statusLabel(record.provenance) : "—"} />
              {(record.facts ?? []).map((fact) => <KeyValue key={fact.label} label={fact.label} value={fact.value} />)}
            </div>
          </section>

          <p className="admin-quiet">Recorded activity is descriptive context; it never proves attendance, productivity, or completion.</p>
        </div>
      ) : null}
    </Drawer>
  );
}

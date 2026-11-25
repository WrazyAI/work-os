"use client";

import { useId, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronDown,
  CircleDashed,
  ExternalLink,
  FileText,
  GitBranch,
  MessageSquare,
} from "lucide-react";
import type { EodEvidenceGroup, EodStructuredReport } from "@/modules/work-os/eod-structured";
import styles from "./eod-structured-view.module.css";

function sourceLabel(group: EodEvidenceGroup) {
  return group.label || group.source;
}

function SourceMark({ source }: { source: string }) {
  if (source === "worktivity") return <img src="/brand/worktivity-mark.png" alt="" />;
  if (source === "loom") return <img src="/brand/loom-mark.png" alt="" />;
  if (source === "github") return <GitBranch size={13} aria-hidden />;
  if (source === "tasks") return <CheckSquare size={13} aria-hidden />;
  if (source === "ghl") return <MessageSquare size={13} aria-hidden />;
  if (source === "calendar") return <CalendarDays size={13} aria-hidden />;
  return <FileText size={13} aria-hidden />;
}

/** The source-grouped evidence record. Read-only by contract: the employee
 * cannot edit or remove a system-recorded source. */
export function EodEvidenceSources({ groups, empty = "No evidence was attached to this report." }: { groups: EodEvidenceGroup[]; empty?: string }) {
  const baseId = useId().replace(/[:]/g, "");
  const [open, setOpen] = useState<string | null>(groups[0]?.source ?? null);
  if (!groups.length) return <p className={styles.evidenceEmpty}>{empty}</p>;

  return (
    <div className={styles.sourcesBlock}>
      <div className={styles.sources} role="group" aria-label="Evidence sources">
        {groups.map((group) => {
          const expanded = open === group.source;
          const sourceId = group.source.replace(/[^a-z0-9_-]/gi, "-");
          const panelId = `${baseId}-${sourceId}-panel`;
          return (
            <button
              key={group.source}
              type="button"
              className={styles.sourcePill}
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? null : group.source)}
            >
              <span className={styles.sourceBadge} data-source={group.source}><SourceMark source={group.source} /></span>
              <span className={styles.sourceName}>{sourceLabel(group)}</span>
              <span className={styles.sourceCount}>{group.items.length}</span>
              <ChevronDown size={11} className={styles.chevron} aria-hidden />
            </button>
          );
        })}
      </div>
      {groups.map((group) => {
        const expanded = open === group.source;
        const sourceId = group.source.replace(/[^a-z0-9_-]/gi, "-");
        const panelId = `${baseId}-${sourceId}-panel`;
        if (!expanded) return null;
        return (
          <section key={group.source} id={panelId} className={styles.panel} aria-label={`${sourceLabel(group)} evidence`}>
            <header className={styles.panelHead}>
              <strong>{group.items.length} {group.items.length === 1 ? "record" : "records"}</strong>
              <span>Read-only</span>
            </header>
            <ul className={styles.panelList}>
              {group.items.map((item) => (
                <li key={item.id} className={styles.panelItem}>
                  <div className={styles.panelMain}>
                    {item.url ? (
                      <a className={styles.panelTitle} href={item.url} target="_blank" rel="noreferrer">
                        {item.title}
                        <ExternalLink size={10} aria-hidden />
                      </a>
                    ) : (
                      <span className={styles.panelTitle}>{item.title}</span>
                    )}
                    {item.summary ? <p className={styles.panelSummary}>{item.summary}</p> : null}
                    {item.meta ? <p className={styles.panelMeta}>{item.meta}</p> : null}
                  </div>
                  {item.at ? (
                    <time className={styles.panelTime} dateTime={item.at}>
                      {new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                    </time>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Section({ icon, title, lines }: { icon: ReactNode; title: string; lines: string[] }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionLabel}>
        <span className={styles.sectionIcon}>{icon}</span>
        <span>{title}</span>
        <span className={styles.sectionCount}>{lines.length}</span>
      </header>
      <div className={styles.sectionBody}>
        {lines.length ? (
          <ul className={styles.lines}>
            {lines.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className={styles.emptyLine}>No line was written.</p>
        )}
      </div>
    </section>
  );
}

/** Read-only rich EOD used by the employee's submitted view and the admin
 * review. The composer is separate; this component never exposes an edit. */
export default function EodStructuredView({ report, variant = "admin" }: { report: EodStructuredReport; variant?: "employee" | "admin" }) {
  return (
    <div className={styles.root} data-variant={variant}>
      <section className={styles.summary} aria-labelledby="structured-eod-summary">
        <header className={styles.summaryHead}>
          <div>
            <span className={styles.eyebrow}>Summary</span>
            <h3 id="structured-eod-summary" className={styles.summaryTitle}>
              {report.summarySource === "assembled"
                ? variant === "employee" ? "Assembled from your entries" : "Assembled from the employee's entries"
                : report.summarySource === "otto"
                  ? variant === "employee" ? "Otto · written from your entries" : "Otto · written from the employee's entries"
                  : variant === "employee" ? "Summary from your report" : "Summary from the employee's report"}
            </h3>
          </div>
        </header>
        <p className={styles.summaryText}>{report.summary || "No summary was written."}</p>
      </section>

      <div className={styles.sections}>
        <Section icon={<Check size={12} aria-hidden />} title="Completed" lines={report.completed} />
        <Section icon={<CircleDashed size={12} aria-hidden />} title="In progress" lines={report.inProgress} />
        <Section icon={<ArrowRight size={12} aria-hidden />} title="Next" lines={report.next} />
      </div>

      {report.loomUrl ? (
        <a className={styles.loom} href={report.loomUrl} target="_blank" rel="noreferrer">
          <img src="/brand/loom-mark.png" alt="" />
          <span>
            <strong>Loom recording attached</strong>
            <small>{report.loomUrl.replace(/^https?:\/\/(www\.)?/, "")}</small>
          </span>
          <ExternalLink size={12} aria-hidden />
        </a>
      ) : null}

      <section className={styles.evidence} aria-labelledby="structured-eod-evidence">
        <header className={styles.evidenceHead}>
          <div>
            <span className={styles.eyebrow}>Recorded</span>
            <h3 id="structured-eod-evidence">Evidence</h3>
          </div>
          <span className={styles.lock}>Immutable · system-recorded</span>
        </header>
        <EodEvidenceSources groups={report.evidence} />
      </section>
    </div>
  );
}

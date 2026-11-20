import { List, Mail } from "lucide-react";
import { AdminButton, Notice, Skeleton } from "./ui";
import EvidenceLedger from "./EvidenceLedger";
import { buildCoverageRows, coverageCell, coverageLevel, evidenceKindOf, evidenceShortDate } from "./evidenceModel";
import type { EvidenceRow, EvidenceSummary } from "./types";

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", day: "numeric", timeZone: "UTC" });
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "—";
}

export default function EvidenceCoverageView({
  summary,
  people,
  dates,
  selection,
  drillRows,
  loading,
  error,
  drillLoading,
  drillError,
  thumbnailIds,
  onSelect,
  onOpenRecord,
  onSelectRow,
}: {
  summary?: EvidenceSummary;
  people: Array<{ id: string; display_name: string }>;
  dates: string[];
  selection: { personId: string | null; date: string } | null;
  drillRows: EvidenceRow[];
  loading: boolean;
  error: Error | null;
  drillLoading: boolean;
  drillError: Error | null;
  thumbnailIds: Set<string>;
  onSelect: (personId: string | null, date: string) => void;
  onOpenRecord: () => void;
  onSelectRow: (row: EvidenceRow) => void;
}) {
  const rows = buildCoverageRows(summary, people, dates);
  const selectedRow = selection ? rows.find((row) => row.personId === selection.personId) ?? null : null;
  const calls = drillRows.filter((row) => evidenceKindOf(row) === "call").length;
  const emails = drillRows.filter((row) => evidenceKindOf(row) === "email").length;
  const cellTotal = selectedRow?.total ?? 0;
  const drillPartial = !!selectedRow && cellTotal > drillRows.length;
  const columnStyle = { gridTemplateColumns: `180px repeat(${dates.length}, minmax(26px, 1fr)) 64px` };

  return (
    <section className="evidence-coverage" aria-label="Evidence coverage">
      <div className="evidence-coverage-head">
        <div>
          <h2>Coverage</h2>
          <p>Every day a source recorded something. Select a cell to read its ledger, then open it in Record.</p>
        </div>
        <div className="evidence-legend">
          <span><i className="evidence-legend-swatch" />0</span>
          <span><i className="evidence-legend-swatch l1" />1–9</span>
          <span><i className="evidence-legend-swatch l2" />10–49</span>
          <span><i className="evidence-legend-swatch l3" />50–99</span>
          <span><i className="evidence-legend-swatch l4" />100+</span>
          <span><Mail size={10} aria-hidden /> email</span>
        </div>
      </div>

      {loading ? (
        <div className="evidence-loading"><Skeleton className="h-32" /></div>
      ) : error ? (
        <div className="evidence-loading"><Notice tone="err">{error.message}</Notice></div>
      ) : !rows.length ? (
        <div className="evidence-empty"><h3>No coverage was recorded in this window</h3><p>The provider has not recorded evidence for the last 14 days.</p></div>
      ) : (
        <div className="evidence-atlas-scroll">
          <div className="evidence-atlas-grid">
            <div className="evidence-atlas-row is-head" style={columnStyle}>
              <div className="evidence-atlas-corner">{dates.length} days · {evidenceShortDate(dates[0])} – {evidenceShortDate(dates[dates.length - 1])}</div>
              {dates.map((date) => <div key={date} className="evidence-atlas-day">{dayLabel(date)}</div>)}
              <div className="evidence-atlas-total">Total</div>
            </div>
            {rows.map((row) => (
              <div key={row.key} className="evidence-atlas-row" style={columnStyle}>
                <div className="evidence-atlas-who">
                  <span className={`avatar ${row.personId ? "" : "is-unknown"}`}>{row.personId ? initials(row.name) : "—"}</span>
                  <span><b>{row.name}</b><small>{row.note}</small></span>
                </div>
                {dates.map((date) => {
                  const cell = coverageCell(row, date);
                  const selected = selection?.personId === row.personId && selection.date === date;
                  if (!cell.count) {
                    return <span key={date} className="evidence-atlas-cell is-empty" title={`${row.name} · ${evidenceShortDate(date)} · no record`}>·</span>;
                  }
                  return (
                    <button
                      key={date}
                      type="button"
                      className={`evidence-atlas-cell${selected ? " is-selected" : ""}`}
                      data-level={coverageLevel(cell.count)}
                      title={`${row.name} · ${evidenceShortDate(date)} · ${cell.count} records${cell.emails ? ` · ${cell.emails} email` : ""}`}
                      aria-label={`${row.name}, ${evidenceShortDate(date)}, ${cell.count} records${cell.emails ? `, ${cell.emails} email` : ""}`}
                      onClick={() => onSelect(row.personId, date)}
                    >
                      <span>{cell.count}</span>{cell.emails ? <Mail size={8} aria-hidden /> : null}
                    </button>
                  );
                })}
                <div className="evidence-atlas-total">{row.total}<small>records</small></div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="evidence-coverage-drill-head">
        <div>
          <h2>{selectedRow ? `${selectedRow.name} · ${evidenceShortDate(selection?.date ?? "")}` : "Select a cell"}</h2>
          <span>{drillLoading ? "Loading ledger…" : drillPartial ? `${drillRows.length} of ${cellTotal} records loaded` : `${drillRows.length} records · ${calls} calls · ${emails} email${emails === 1 ? "" : "s"}`}</span>
        </div>
        <AdminButton variant="secondary" icon={List} disabled={!selection} onClick={onOpenRecord}>Open in Record</AdminButton>
      </div>
      {drillPartial ? <div className="evidence-partial">Showing {drillRows.length} of {cellTotal} records in this cell. Open in Record to narrow the day.</div> : null}
      <EvidenceLedger rows={drillRows} onSelect={onSelectRow} thumbnailIds={thumbnailIds} loading={drillLoading} error={drillError} emptyTitle="No evidence in this cell" emptyBody="The coverage count and the ledger are read from the same provider record; this cell has no rows to show." />
    </section>
  );
}

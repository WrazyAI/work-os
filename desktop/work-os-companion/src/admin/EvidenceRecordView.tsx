import { Mail, Phone, Search, Users } from "lucide-react";
import { SelectField } from "./ui";
import EvidenceLedger from "./EvidenceLedger";
import { buildDateRange, evidenceShortDate } from "./evidenceModel";
import type { EvidenceRow } from "./types";

export type EvidenceKindFilter = "all" | "calls" | "emails" | "texts" | "work" | "context";

export type EvidenceRecordFilters = {
  personId: string;
  source: string;
  from: string;
  to: string;
  search: string;
  kind: EvidenceKindFilter;
  disputed: boolean;
};

const KIND_OPTIONS: Array<{ value: EvidenceKindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "calls", label: "Calls" },
  { value: "emails", label: "Emails" },
  { value: "texts", label: "Texts" },
  { value: "work", label: "Work" },
  { value: "context", label: "Context" },
];

export default function EvidenceRecordView({
  rows,
  viewTotal,
  loadedCount,
  partial,
  counts,
  peopleCount,
  capped,
  pulseDays,
  pulseFrom,
  pulseTo,
  pulseLoading,
  pulseError,
  filters,
  personOptions,
  sourceOptions,
  scopeLabel,
  loading,
  error,
  thumbnailIds,
  onFilters,
  onPickDay,
  onSelect,
  onClearFilters,
}: {
  rows: EvidenceRow[];
  viewTotal: number;
  loadedCount: number;
  partial: boolean;
  counts: { all: number; calls: number; emails: number; texts: number; work: number; context: number };
  peopleCount: number;
  capped?: boolean;
  pulseDays: Array<{ date: string; count: number }>;
  pulseFrom: string;
  pulseTo: string;
  pulseLoading?: boolean;
  pulseError?: Error | null;
  filters: EvidenceRecordFilters;
  personOptions: Array<{ value: string; label: string }>;
  sourceOptions: Array<{ value: string; label: string }>;
  scopeLabel: string;
  loading: boolean;
  error: Error | null;
  thumbnailIds: Set<string>;
  onFilters: (patch: Partial<EvidenceRecordFilters>) => void;
  onPickDay: (date: string) => void;
  onSelect: (row: EvidenceRow) => void;
  onClearFilters: () => void;
}) {
  const pulse = new Map(pulseDays.map((day) => [day.date, day.count]));
  const dates = buildDateRange(pulseFrom, pulseTo);
  const max = Math.max(...dates.map((date) => pulse.get(date) ?? 0), 1);
  const peakDate = dates.reduce((best, date) => ((pulse.get(date) ?? 0) > (pulse.get(best) ?? 0) ? date : best), dates[0]);
  const callCount = filters.kind === "all" || filters.kind === "calls" ? counts.calls : 0;
  const emailCount = filters.kind === "all" || filters.kind === "emails" ? counts.emails : 0;

  return (
    <section className="evidence-record" aria-label="Evidence record">
      <div className="evidence-index">
        <div className="evidence-index-primary">
          <p className="evidence-index-kicker">In this view</p>
          <div className="evidence-index-number">{capped && !loading ? "≥" : ""}{loading ? "—" : viewTotal.toLocaleString("en-US")}<small>record{viewTotal === 1 ? "" : "s"}</small></div>
          <p className="evidence-index-scope">{scopeLabel}</p>
        </div>
        <div className="evidence-index-facts">
          <div className="evidence-fact"><span><Phone size={12} aria-hidden /> Calls</span><b>{loading ? "—" : callCount.toLocaleString("en-US")}</b><small>provider actions</small></div>
          <div className="evidence-fact"><span><Mail size={12} aria-hidden /> Emails</span><b>{loading ? "—" : emailCount.toLocaleString("en-US")}</b><small>sent messages</small></div>
          <div className="evidence-fact"><span><Users size={12} aria-hidden /> People</span><b>{loading ? "—" : peopleCount.toLocaleString("en-US")}</b><small>credited or contextual</small></div>
          <div className="evidence-index-note"><b>{loading ? "Loading" : partial ? `${loadedCount.toLocaleString("en-US")} loaded` : "Complete view"}</b>{capped ? "Counts capped · " : ""}Provider occurrence time</div>
        </div>
        <div className="evidence-pulse-wrap">
          <div className="evidence-pulse-head"><span>Last 14 days · all sources</span><b>{pulseError ? "Unavailable" : pulseLoading ? "Loading" : `Peak ${pulse.get(peakDate) ?? 0} · ${evidenceShortDate(peakDate)}`}</b></div>
          {pulseError ? (
            <div className="evidence-pulse-unavailable">Pulse unavailable. Record counts are still shown.</div>
          ) : pulseLoading ? (
            <div className="evidence-pulse-unavailable">Loading the last 14 days…</div>
          ) : (
            <>
              <div className="evidence-pulse" role="group" aria-label="Evidence volume over the last 14 days">
                {dates.map((date) => {
                  const count = pulse.get(date) ?? 0;
                  const height = count === 0 ? 3 : Math.max(4, Math.round((count / max) * 34));
                  const selected = filters.from === date && filters.to === date;
                  const inRange = date >= filters.from && date <= filters.to;
                  return (
                    <button
                      key={date}
                      type="button"
                      className={`${count ? "has-data" : ""}${inRange ? " is-in-range" : ""}${selected ? " is-selected" : ""}`.trim()}
                      style={{ height }}
                      title={`${evidenceShortDate(date)} · ${count} record${count === 1 ? "" : "s"}`}
                      aria-label={`${evidenceShortDate(date)}, ${count} records`}
                      onClick={() => onPickDay(date)}
                    />
                  );
                })}
              </div>
              <div className="evidence-pulse-axis"><span>{evidenceShortDate(dates[0])}</span><span>{evidenceShortDate(dates[dates.length - 1])}</span></div>
            </>
          )}
        </div>
      </div>

      <div className="evidence-query">
        <label className="evidence-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            value={filters.search}
            aria-label="Search evidence"
            placeholder="Search title or summary"
            onChange={(event) => onFilters({ search: event.target.value })}
          />
        </label>
        <SelectField label="Person" value={filters.personId} onChange={(value) => onFilters({ personId: value })} options={personOptions} />
        <SelectField label="Source" value={filters.source} onChange={(value) => onFilters({ source: value })} options={sourceOptions} />
        <div className="evidence-kinds" role="group" aria-label="Evidence kind">
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`evidence-chip${filters.kind === option.value ? " is-active" : ""}`}
              aria-pressed={filters.kind === option.value}
              onClick={() => onFilters({ kind: option.value })}
            >
              {option.label}<b>{counts[option.value].toLocaleString("en-US")}</b>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`evidence-chip evidence-disputed${filters.disputed ? " is-active" : ""}`}
          aria-pressed={filters.disputed}
          onClick={() => onFilters({ disputed: !filters.disputed })}
        >
          Disputed only
        </button>
      </div>

      {partial ? (
        <div className="evidence-partial">
          Showing the most recent 500 records in this range. Narrow the date range or add a kind filter to see the rest.
        </div>
      ) : null}

      <EvidenceLedger rows={rows} onSelect={onSelect} thumbnailIds={thumbnailIds} loading={loading} error={error} onClearFilters={onClearFilters} />

      <div className="evidence-foot">
        <span><b>{loadedCount.toLocaleString("en-US")}</b> of {viewTotal.toLocaleString("en-US")} records in this view</span>
        <span>{partial ? "Partial view" : "Repeated calls are grouped by hour"} · ordered by provider occurrence time</span>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarRange, RefreshCw, Target } from "lucide-react";
import { useEmployeeDay } from "./useEmployeeDay";
import { fetchJson, calendarDateLabel, longDateLabel, type EmployeeInsightsResponse } from "./model";
import {
  EmptyState,
  IconButton,
  Masthead,
  Notice,
  Panel,
  PanelHeader,
  SecondaryButton,
  Skeleton,
  StatusPill,
  inputClass,
  inputStyle,
} from "./ui";

type Range = "day" | "7d" | "30d";

const RANGES: Array<{ id: Range; label: string }> = [
  { id: "day", label: "Day" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
];

export default function EmployeeInsights() {
  const { day, refresh } = useEmployeeDay();
  const [range, setRange] = useState<Range>("7d");
  const [through, setThrough] = useState("");

  useEffect(() => {
    if (day.data?.shiftDate) setThrough((current) => current || day.data!.shiftDate);
  }, [day.data?.shiftDate]);

  const insights = useQuery<EmployeeInsightsResponse>({
    queryKey: ["work-os", "employee-insights", range, through],
    queryFn: () => fetchJson(`/api/work-os/me/insights?range=${range}&through=${encodeURIComponent(through)}`),
    enabled: !!through,
    staleTime: 60_000,
  });

  const days = insights.data?.days ?? [];
  const error = day.error || insights.error;

  return (
    <div>
      <Masthead
        eyebrow="Work OS · Insights"
        title="Your record"
        meta="The shared daily-workspace record · no productivity score, no quality judgement."
        actions={
          <>
            <nav aria-label="Insight range" className="flex rounded-[10px] border p-0.5" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              {RANGES.map((item) => {
                const active = range === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setRange(item.id)}
                    className="rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition"
                    style={active ? { background: "color-mix(in srgb, var(--accent-deep) 12%, var(--bg-card))", color: "var(--accent-deep)" } : { color: "var(--text-secondary)" }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <input
              type="date"
              value={through}
              max={day.data?.shiftDate ?? undefined}
              onChange={(event) => setThrough(event.target.value)}
              aria-label="Through date"
              className={`${inputClass} w-auto`}
              style={inputStyle}
            />
            <IconButton label="Refresh insights" onClick={() => void refresh()} disabled={insights.isFetching}>
              <RefreshCw size={15} className={insights.isFetching ? "animate-spin" : undefined} />
            </IconButton>
          </>
        }
      />

      {error ? <Notice tone="err" className="mb-5">{(error as Error).message}</Notice> : null}

      {insights.data?.freshness.stale ? (
        <Notice tone="warn" className="mb-5">
          Retained data is stale{insights.data.freshness.staleAt ? ` since ${new Date(insights.data.freshness.staleAt).toLocaleString()}` : ""}. {insights.data.freshness.error || "Refresh is pending."}
        </Notice>
      ) : null}

      {insights.isLoading && !insights.data ? (
        <div className="grid gap-5" aria-busy="true">
          <Panel className="p-5"><Skeleton className="h-4 w-44" /><Skeleton className="mt-3 h-12 w-full" /></Panel>
          <Panel className="p-5"><Skeleton className="h-4 w-32" /><Skeleton className="mt-3 h-20 w-full" /></Panel>
        </div>
      ) : insights.data ? (
        <div className="grid gap-5">
          <Panel>
            <PanelHeader
              icon={<Target size={16} />}
              title="Brief"
              meta={`${calendarDateLabel(insights.data.from)} – ${calendarDateLabel(insights.data.through)} · generated from the same record you see below.`}
            />
            <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <p className="text-[14px] leading-6 text-[var(--text-primary)]">{insights.data.brief.summary || "No insight record is available for this range."}</p>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                <BriefList title="Wins" items={insights.data.brief.wins} />
                <BriefList title="Attention" items={insights.data.brief.attention} />
                <BriefList title="Next focus" items={insights.data.brief.nextFocus} />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader icon={<CalendarRange size={16} />} title="Daily records" meta={`${days.length} day${days.length === 1 ? "" : "s"} in this range. Newest first.`} />
            {days.length ? (
              <ul>
                {[...days].reverse().map((item) => (
                  <li key={item.date} className="border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <button type="button" onClick={() => setThrough(item.date)} className="text-left text-[13px] font-semibold hover:underline" style={{ color: "var(--accent-deep)" }}>
                        {longDateLabel(item.date)}
                      </button>
                      <div className="flex flex-wrap items-center gap-2">
                        {item.sessionQuality.message ? <StatusPill tone="overdue">{item.sessionQuality.message}</StatusPill> : null}
                        <StatusPill tone="open">{item.breakFreshness}</StatusPill>
                      </div>
                    </div>
                    <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums text-[var(--text-secondary)]">
                      <span>{item.completed} completed</span>
                      <span>{item.progressed} progressed</span>
                      <span>{item.deferred} deferred</span>
                      <span>{item.carried} carried</span>
                      <span>{item.unplanned} unplanned</span>
                    </p>
                    {item.goal.text ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-tertiary)]">Goal: {item.goal.text}</p> : null}
                    {item.references.length ? (
                      <p className="mt-1.5 flex flex-wrap gap-3">
                        {item.references.slice(0, 4).map((reference) => (
                          <a key={reference.id} href={reference.target} className="text-[11px] font-semibold" style={{ color: "var(--accent-deep)" }}>{reference.label}</a>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<CalendarRange size={20} />} title="No recorded days in this range" message="Work you log or plan will appear here day by day." />
            )}
          </Panel>
        </div>
      ) : (
        <EmptyState
          title="Insights could not be loaded"
          message={(insights.error as Error)?.message}
          action={<SecondaryButton onClick={() => void insights.refetch()}>Try again</SecondaryButton>}
        />
      )}
    </div>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{title}</h3>
      {items.length ? (
        <ul className="mt-1.5 grid gap-1">
          {items.map((item) => (
            <li key={item} className="text-[12px] leading-5 text-[var(--text-secondary)]">{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">Nothing to report.</p>
      )}
    </div>
  );
}

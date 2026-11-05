"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, FileCheck2, MessageSquareText, Search, ShieldCheck, Users } from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { adminFetch, adminKeys, type AdminOverview, type PersonDetailResponse } from "./api";
import {
  Avatar,
  Drawer,
  EmptyState,
  Group,
  Notice,
  SectionHeading,
  SegmentedControl,
  Skeleton,
  StateMark,
  formatClock,
  relativeTime,
  statusLabel,
} from "./ui";

function stateTone(state: string) {
  if (state === "active") return "ok" as const;
  if (state === "paused") return "warn" as const;
  return "neutral" as const;
}

function stateLabel(state: string) {
  if (state === "active") return "On shift";
  if (state === "paused") return "Paused";
  if (state === "off_shift") return "Off shift";
  return "Not observed";
}

export default function AdminPeoplePage() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const overview = useQuery<AdminOverview>({
    queryKey: adminKeys.overview(today),
    queryFn: () => adminFetch<AdminOverview>("/api/work-os/admin/overview"),
    staleTime: 60_000,
  });
  const roster = useQuery<{ people: Array<Record<string, unknown>>; roleProfiles: Array<{ id: string; name: string }> }>({
    queryKey: adminKeys.people(),
    queryFn: () => adminFetch("/api/work-os/people"),
    staleTime: 60_000,
  });
  const detail = useQuery<PersonDetailResponse>({
    queryKey: adminKeys.person(selectedId ?? ""),
    queryFn: () => adminFetch<PersonDetailResponse>(`/api/work-os/admin/people/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 60_000,
  });
  const updatePerson = useMutation({
    mutationFn: (body: Record<string, unknown>) => adminFetch("/api/work-os/people", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["work-os", "people"] });
      void queryClient.invalidateQueries({ queryKey: adminKeys.person(selectedId ?? "") });
      void queryClient.invalidateQueries({ queryKey: ["work-os", "admin", "overview", "readiness"] });
    },
  });

  const peopleById = useMemo(() => {
    const map = new Map<string, AdminOverview["people"][number]>();
    for (const person of overview.data?.people ?? []) map.set(person.personId, person);
    return map;
  }, [overview.data]);

  const roleOptions = (roster.data?.roleProfiles ?? []).map((profile) => ({ value: profile.id, label: profile.name }));
  const selectedStatus = selectedId ? peopleById.get(selectedId) ?? null : null;

  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewFilter>("all");

  const board = useMemo(() => {
    const rows: BoardRow[] = (roster.data?.people ?? []).map((person) => {
      const status = peopleById.get(String(person.id));
      const role = status?.roleProfile ?? null;
      const schedule = status?.schedule ?? null;
      const state = status?.attendance.state ?? "unknown";
      const needs = [!role ? "role profile" : null, !schedule ? "schedule" : null].filter(Boolean) as string[];
      return { person, status, role, schedule, state, needs };
    });
    const needle = query.trim().toLowerCase();
    const searched = needle
      ? rows.filter((row) => `${row.person.display_name ?? ""} ${row.person.email ?? ""}`.toLowerCase().includes(needle))
      : rows;
    const filtered = view === "needs_setup"
      ? searched.filter((row) => row.needs.length > 0)
      : view === "on_shift"
        ? searched.filter((row) => row.state === "active" || row.state === "paused")
        : searched;
    const byName = (left: BoardRow, right: BoardRow) => String(left.person.display_name ?? "").localeCompare(String(right.person.display_name ?? ""));
    const active = filtered.filter((row) => row.state === "active" || row.state === "paused");
    const unconfigured = filtered.filter((row) => row.state !== "active" && row.state !== "paused" && row.needs.length > 0);
    const quiet = filtered.filter((row) => row.state !== "active" && row.state !== "paused" && !row.needs.length);
    return {
      onShift: active.sort(byName),
      needsSetup: unconfigured.sort(byName),
      quiet: quiet.sort(byName),
      total: rows.length,
      setupCount: rows.filter((row) => row.needs.length > 0).length,
      empty: !filtered.length,
    };
  }, [roster.data, peopleById, query, view]);

  return (
    <div className="flex flex-col">
      <Group label="Roster" detail="Mappings, schedules, and today's recorded state.">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
          <SegmentedControl<ViewFilter>
            ariaLabel="Roster view"
            value={view}
            onChange={setView}
            options={[
              { value: "all", label: "Everyone" },
              { value: "needs_setup", label: `Needs setup${board.setupCount ? ` (${board.setupCount})` : ""}` },
              { value: "on_shift", label: "On shift" },
            ]}
          />
          <label className="relative block w-full sm:w-[230px]">
            <span className="sr-only">Search people</span>
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or email"
              className="min-h-[34px] w-full rounded-[9px] border pl-8 pr-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus-visible:border-[var(--border-hot)]"
              style={{ borderColor: "var(--border)", background: "var(--color-paper)" }}
            />
          </label>
        </div>

        {overview.isLoading || roster.isLoading ? (
          <div className="grid gap-1.5">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
          </div>
        ) : overview.error || roster.error ? (
          <Notice tone="err">{((overview.error || roster.error) as Error).message}</Notice>
        ) : board.empty ? (
          <EmptyState
            icon={Users}
            title={query ? "No one matches that search" : "No people yet"}
            body={query ? "Clear the search or switch the view." : "People are created through onboarding or membership mapping in Settings."}
          />
        ) : (
          <div className="flex flex-col">
            {board.onShift.length ? (
              <BoardSection
                title="On shift"
                note="Recording right now"
                rows={board.onShift}
                onOpen={setSelectedId}
              />
            ) : null}
            {board.needsSetup.length ? (
              <BoardSection
                title="Needs setup"
                note="Record a role profile and a schedule before a workday can be recorded."
                rows={board.needsSetup}
                onOpen={setSelectedId}
              />
            ) : null}
            {board.quiet.length ? (
              <BoardSection
                title="Other people"
                note="Configured, not on shift right now"
                rows={board.quiet}
                onOpen={setSelectedId}
              />
            ) : null}
          </div>
        )}
      </Group>

      <Drawer
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={detail.data?.person.display_name ?? selectedStatus?.displayName ?? "Person"}
        subtitle={detail.data?.person.email ?? selectedStatus?.email ?? undefined}
        width={620}
      >
        {detail.isLoading ? (
          <div className="grid gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : detail.error || !detail.data ? (
          <Notice tone="err">{((detail.error as Error | null)?.message) ?? "The person record could not be loaded."}</Notice>
        ) : (
          <div className="grid gap-6">
            {/* Identity + mappings */}
            <section className="grid gap-3">
              <SectionHeading icon={ShieldCheck} title="Mappings" detail="Provider identities and the role profile used for planning." />
              <dl className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                <div className="flex items-center justify-between gap-3 py-2 first:pt-1 last:pb-1">
                  <dt className="text-[11.5px] text-[var(--text-tertiary)]">Task record</dt>
                  <dd className="min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">{detail.data.person.nifty_member_id ?? "Not mapped"}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 py-2 first:pt-1 last:pb-1">
                  <dt className="text-[11.5px] text-[var(--text-tertiary)]">Worktivity employee</dt>
                  <dd className="min-w-0 truncate text-[12px] font-medium text-[var(--text-primary)]">{detail.data.person.worktivity_employee_id ?? "Not mapped"}</dd>
                </div>
              </dl>
              <label className="grid gap-1.5 text-[11.5px] font-medium text-[var(--text-secondary)]">
                Role profile
                <select
                  value={detail.data.person.role_profile_id ?? ""}
                  onChange={(event) => updatePerson.mutate({ id: detail.data!.person.id, role_profile_id: event.target.value || null })}
                  className="min-h-[34px] rounded-[10px] border bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
                >
                  <option value="">Unmapped</option>
                  {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {updatePerson.error ? <Notice tone="err">{(updatePerson.error as Error).message}</Notice> : null}
              {detail.data.teams.length ? (
                <p className="text-[11.5px] text-[var(--text-tertiary)]">
                  {detail.data.teams.map((membership) => `${membership.team?.name ?? "Team"}${membership.is_manager ? " · manager" : ""}`).join(", ")}
                </p>
              ) : (
                <p className="text-[11.5px] text-[var(--text-tertiary)]">No team membership recorded.</p>
              )}
            </section>

            {/* Schedule */}
            <section className="grid gap-2.5">
              <SectionHeading icon={CalendarClock} title="Schedule" detail="Most recent configured schedule and upcoming exceptions." />
              {detail.data.schedules.length ? (
                <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {detail.data.schedules.slice(0, 2).map((schedule) => (
                    <li key={String(schedule.id)} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 first:pt-1 last:pb-1">
                      <span className="text-[12px] font-medium text-[var(--text-primary)]">
                        {String(schedule.shift_start).slice(0, 5)}–{String(schedule.shift_end).slice(0, 5)} · {String(schedule.timezone)}
                      </span>
                      <span className="text-[11px] text-[var(--text-tertiary)]">
                        {Array.isArray(schedule.days_of_week) ? (schedule.days_of_week as number[]).map((day) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][day]).join(" ") : ""}
                        {" · "}from {formatWorkOsDate(String(schedule.effective_from))}
                        {schedule.effective_to ? ` to ${formatWorkOsDate(String(schedule.effective_to))}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11.5px] text-[var(--text-tertiary)]">No schedule is configured.</p>
              )}
              {detail.data.exceptions.length ? (
                <ul className="grid gap-1 text-[11.5px] text-[var(--text-secondary)]">
                  {detail.data.exceptions.map((exception) => (
                    <li key={String(exception.id)} className="flex items-center justify-between gap-2">
                      <span>{formatWorkOsDate(String(exception.exception_date))}</span>
                      <span className="text-[var(--text-tertiary)]">{statusLabel(String(exception.kind))}{exception.note ? ` · ${String(exception.note)}` : ""}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {/* Recent sessions */}
            <section className="grid gap-2.5">
              <SectionHeading icon={CalendarClock} title="Recent workdays" detail="The last two weeks of mirrored sessions." />
              {detail.data.sessions.length ? (
                <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {detail.data.sessions.slice(0, 8).map((session) => (
                    <li key={String(session.id)} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-1 last:pb-1 text-[12px]">
                      <span className="font-medium text-[var(--text-primary)]">{formatWorkOsDate(String(session.shift_date))}</span>
                      <span className="tabular-nums text-[var(--text-secondary)]">
                        {session.clocked_in_at ? formatClock(String(session.clocked_in_at)) : "—"} – {session.clocked_out_at ? formatClock(String(session.clocked_out_at)) : "open"}
                      </span>
                      <span className="flex items-center gap-3">
                        <StateMark tone={String(session.correction_status) === "needs_correction" ? "warn" : "neutral"}>
                          {statusLabel(String(session.state))}
                        </StateMark>
                        {String(session.correction_status) === "needs_correction" ? <StateMark tone="warn">Needs correction</StateMark> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11.5px] text-[var(--text-tertiary)]">No sessions recorded in the last two weeks.</p>
              )}
            </section>

            {/* Reports */}
            <section className="grid gap-2.5">
              <SectionHeading icon={FileCheck2} title="EOD reports" detail="The most recent reports and their review state." />
              {detail.data.reports.length ? (
                <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                  {detail.data.reports.slice(0, 6).map((report) => (
                    <li key={String(report.id)} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 first:pt-1 last:pb-1 text-[12px]">
                      <span className="font-medium text-[var(--text-primary)]">{formatWorkOsDate(String(report.report_date))}</span>
                      <span className="text-[11px] text-[var(--text-tertiary)]">{report.submitted_at ? `submitted ${relativeTime(String(report.submitted_at))}` : "not submitted"}</span>
                      <StateMark tone={String(report.status) === "approved" ? "ok" : String(report.status) === "pending_review" ? "info" : String(report.status) === "rejected" ? "err" : "neutral"}>
                        {statusLabel(String(report.status))}
                      </StateMark>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11.5px] text-[var(--text-tertiary)]">No reports recorded yet.</p>
              )}
            </section>

            {/* Updates + recaps */}
            <section className="grid gap-2.5">
              <SectionHeading icon={MessageSquareText} title="Recent updates and recaps" detail="Employee-authored updates and evidence-backed interval recaps." />
              <ul className="divide-y" style={{ borderColor: "var(--border-subtle)" }}>
                {detail.data.updates.slice(0, 5).map((update) => (
                  <li key={String(update.id)} className="py-2.5 first:pt-1 last:pb-1">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-tertiary)]">
                      <span>{formatWorkOsDate(String(update.shift_date))} · {statusLabel(String(update.kind))}</span>
                      <span>{relativeTime(String(update.occurred_at ?? update.created_at))}</span>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{String(update.input_text ?? "").slice(0, 220) || "No text recorded."}</p>
                  </li>
                ))}
                {detail.data.intervals.slice(0, 3).map((interval) => (
                  <li key={String(interval.id)} className="py-2.5 first:pt-1 last:pb-1">
                    <div className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="font-medium" style={{ color: "var(--status-observed)" }}>{formatWorkOsDate(String(interval.local_date))} — recap</span>
                      <span className="text-[var(--text-tertiary)]">
                        {String(interval.review_status) === "confirmed" ? "Employee confirmed" : String(interval.review_status) === "amended" ? "Employee amended" : "AI-inferred"}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">{String(interval.headline ?? interval.final_detail ?? interval.ai_detail ?? "No recap detail recorded.")}</p>
                  </li>
                ))}
                {!detail.data.updates.length && !detail.data.intervals.length ? (
                  <li className="py-2 text-[11.5px] text-[var(--text-tertiary)]">No updates or recaps recorded.</li>
                ) : null}
              </ul>
            </section>

            {/* Evidence summary */}
            <section className="grid gap-2.5">
              <SectionHeading icon={ShieldCheck} title="Evidence (7 days)" detail="Observed activity and output evidence, with disputed items called out." />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-[var(--text-secondary)]">
                <span>{detail.data.evidenceSummary.total} items</span>
                <StateMark tone="observed">{detail.data.evidenceSummary.activity} activity</StateMark>
                <span>{detail.data.evidenceSummary.output} output</span>
                {detail.data.evidenceSummary.disputed > 0 ? <StateMark tone="warn">{detail.data.evidenceSummary.disputed} disputed</StateMark> : null}
              </div>
            </section>
          </div>
        )}
      </Drawer>
    </div>
  );
}

type ViewFilter = "all" | "needs_setup" | "on_shift";

type BoardRow = {
  person: Record<string, unknown>;
  status: AdminOverview["people"][number] | undefined;
  role: string | null;
  schedule: AdminOverview["people"][number]["schedule"];
  state: string;
  needs: string[];
};

/** One state band of the coverage board: a quiet heading, then flat rows. */
function BoardSection({ title, note, rows, onOpen }: {
  title: string;
  note: string;
  rows: BoardRow[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="border-b py-3 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pb-1">
        <h3 className="text-[11.5px] font-semibold text-[var(--text-secondary)]">
          {title}
          <span className="ml-1.5 font-medium tabular-nums text-[var(--text-tertiary)]">{rows.length}</span>
        </h3>
        <p className="text-[10.5px] text-[var(--text-tertiary)]">{note}</p>
      </div>
      <div>
        {rows.map((row) => <PersonRow key={String(row.person.id)} row={row} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

function PersonRow({ row, onOpen }: { row: BoardRow; onOpen: (id: string) => void }) {
  const personId = String(row.person.id);
  const status = row.status;
  const today = status
    ? [
        status.updatesToday ? `${status.updatesToday} update${status.updatesToday === 1 ? "" : "s"}` : null,
        status.tasksCompletedToday ? `${status.tasksCompletedToday} done` : null,
        status.evidenceToday ? `${status.evidenceToday} evidence` : null,
      ].filter(Boolean)
    : [];
  const missing = [
    !row.role ? "No role profile" : null,
    !row.schedule ? "No schedule" : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={() => onOpen(personId)}
      className="flex w-full items-center gap-3 border-b py-2.5 text-left transition last:border-b-0 hover:bg-[var(--bg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      style={{ borderColor: "var(--border-subtle)" }}
    >
      <Avatar name={String(row.person.display_name ?? "")} size={26} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-[12.5px] font-semibold text-[var(--text-primary)]">{String(row.person.display_name ?? "Unnamed person")}</span>
          {row.state === "active" || row.state === "paused" ? (
            <StateMark tone={stateTone(row.state)}>
              {stateLabel(row.state)}
              {status?.attendance.freshness === "stale" ? " · stale" : ""}
            </StateMark>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-tertiary)]">
          {row.role ?? "No role profile"}
          {row.schedule ? ` · ${row.schedule.start}–${row.schedule.end} ${row.schedule.timezone}` : " · No schedule"}
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-3 text-[11px] tabular-nums text-[var(--text-secondary)] lg:flex">
        {today.length ? today.join(" · ") : null}
      </span>
      <span className="shrink-0">
        {status?.eodToday ? (
          <StateMark tone={status.eodToday === "approved" ? "ok" : status.eodToday === "pending_review" ? "info" : "neutral"}>
            {statusLabel(status.eodToday)}
          </StateMark>
        ) : status?.eodOutstanding ? (
          <StateMark tone="warn">EOD outstanding</StateMark>
        ) : missing.length ? (
          <span className="text-[10.5px] font-semibold" style={{ color: "var(--status-warn)" }}>Needs setup</span>
        ) : null}
      </span>
      <ChevronRight size={13} className="shrink-0 text-[var(--text-tertiary)]" aria-hidden />
    </button>
  );
}

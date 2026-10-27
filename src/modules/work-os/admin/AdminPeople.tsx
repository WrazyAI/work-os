"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileCheck2, MessageSquareText, ShieldCheck, Users } from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { adminFetch, adminKeys, type AdminOverview, type PersonDetailResponse } from "./api";
import {
  AdminCard,
  Avatar,
  Drawer,
  EmptyState,
  Notice,
  SectionHeading,
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
    },
  });

  const peopleById = useMemo(() => {
    const map = new Map<string, AdminOverview["people"][number]>();
    for (const person of overview.data?.people ?? []) map.set(person.personId, person);
    return map;
  }, [overview.data]);

  const roleOptions = (roster.data?.roleProfiles ?? []).map((profile) => ({ value: profile.id, label: profile.name }));
  const selectedStatus = selectedId ? peopleById.get(selectedId) ?? null : null;

  return (
    <div className="grid gap-5">
      <AdminCard padded={false}>
        <div className="px-5 pt-4 pb-2">
          <SectionHeading
            icon={Users}
            title="Roster"
            detail="Mappings, schedules, and today's recorded state. Select a person to open their record."
          />
        </div>
        {overview.isLoading || roster.isLoading ? (
          <div className="grid gap-2 px-5 pb-5">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
          </div>
        ) : overview.error || roster.error ? (
          <div className="px-5 pb-5"><Notice tone="err">{((overview.error || roster.error) as Error).message}</Notice></div>
        ) : (roster.data?.people ?? []).length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-[12.5px]">
              <thead>
                <tr className="border-y text-[11px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border-subtle)" }}>
                  <th className="px-5 py-2.5 font-medium">Person</th>
                  <th className="px-3 py-2.5 font-medium">Role profile</th>
                  <th className="px-3 py-2.5 font-medium">Schedule</th>
                  <th className="px-3 py-2.5 font-medium">Status now</th>
                  <th className="px-3 py-2.5 font-medium">Today</th>
                  <th className="px-3 py-2.5 font-medium">EOD</th>
                  <th className="px-5 py-2.5 font-medium">Last update</th>
                </tr>
              </thead>
              <tbody>
                {(roster.data?.people ?? []).map((person) => {
                  const personId = String(person.id);
                  const status = peopleById.get(personId);
                  return (
                    <tr
                      key={personId}
                      tabIndex={0}
                      className="cursor-pointer border-b transition hover:bg-[var(--bg-secondary)]"
                      style={{ borderColor: "var(--border-subtle)" }}
                      onClick={() => setSelectedId(personId)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(personId);
                        }
                      }}
                    >
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={String(person.display_name)} size={28} />
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-[var(--text-primary)]">{String(person.display_name)}</span>
                            <span className="block truncate text-[11px] text-[var(--text-tertiary)]">{person.email ? String(person.email) : "No email"}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[var(--text-secondary)]">{status?.roleProfile ?? "Unmapped"}</td>
                      <td className="px-3 py-3 text-[var(--text-secondary)]">
                        {status?.schedule ? `${status.schedule.start}–${status.schedule.end} ${status.schedule.timezone}` : "No schedule"}
                      </td>
                      <td className="px-3 py-3">
                        <StateMark tone={stateTone(status?.attendance.state ?? "unknown")}>
                          {stateLabel(status?.attendance.state ?? "unknown")}
                          {status?.attendance.freshness === "stale" ? " · stale" : ""}
                        </StateMark>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-[var(--text-secondary)]">
                        {status ? `${status.updatesToday} update${status.updatesToday === 1 ? "" : "s"} · ${status.tasksCompletedToday} done${status.evidenceToday ? ` · ${status.evidenceToday} evidence` : ""}` : "—"}
                      </td>
                      <td className="px-3 py-3">
                        {status?.eodToday ? (
                          <StateMark tone={status.eodToday === "approved" ? "ok" : status.eodToday === "pending_review" ? "info" : "neutral"}>
                            {statusLabel(status.eodToday)}
                          </StateMark>
                        ) : status?.eodOutstanding ? (
                          <StateMark tone="warn">Outstanding</StateMark>
                        ) : (
                          <span className="text-[var(--text-tertiary)]">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-[11.5px] text-[var(--text-tertiary)]">{status?.lastUpdateAt ? relativeTime(status.lastUpdateAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 pb-5">
            <EmptyState icon={Users} title="No people yet" body="People are created through onboarding or membership mapping in Settings." />
          </div>
        )}
      </AdminCard>

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

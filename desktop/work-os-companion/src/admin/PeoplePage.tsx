import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileCheck2, MessageSquareText, Search, ShieldCheck, Users } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import { formatWorkOsFullDate, formatWorkOsTime } from "../dateFormat";
import { buildPersonWorkdays, recapReviewLabel, recapsForDay, reportForDay } from "./adminPersonRecord";
import {
  adminKeys,
  ADMIN_DETAIL_STALE_MS,
  ADMIN_STALE_MS,
  attendanceLabel,
  attendanceTone,
  fetchAdminOverview,
  fetchPeople,
  fetchPersonDetail,
  formatDuration,
  normalizeAdminOverview,
  normalizePeople,
  normalizePersonDetail,
  relativeTime,
  reportTone,
  statusLabel,
  todayIso,
  updateAdminPerson,
} from "./data";
import { AdminCard, AdminControls, AdminControlsGroup, Avatar, Drawer, Empty, KeyValue, Notice, Pill, Segmented, SelectField, Skeleton } from "./ui";
import type { AdminOverview, AdminSection, AdminSectionFocus, PersonDetailResponse } from "./types";

type AttendanceFilter = "all" | "active" | "paused" | "off_shift" | "unknown";

/** The roster: every mapped person with today's recorded state, and a drawer
 * that carries the person's own record — mappings, today's measures, schedule,
 * workdays, today's recaps, reports, and the evidence summary behind their row.
 * Every measure whose record has a destination opens it. */
export default function PeoplePage({ initialPersonId, onOpenReport, onOpenSection, onOpenRecaps }: {
  initialPersonId?: string;
  onOpenReport?: (reportId: string) => void;
  onOpenSection?: (section: AdminSection, focus?: AdminSectionFocus) => void;
  onOpenRecaps?: () => void;
}) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [attendance, setAttendance] = useState<AttendanceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialPersonId ?? null);
  const [receipt, setReceipt] = useState<string | null>(null);

  const overview = useQuery<AdminOverview>({
    queryKey: adminKeys.overview(todayIso()),
    queryFn: () => fetchAdminOverview(),
    select: normalizeAdminOverview,
    staleTime: ADMIN_STALE_MS,
  });
  const roster = useQuery({
    queryKey: adminKeys.people(),
    queryFn: fetchPeople,
    select: normalizePeople,
    // The roster is a list read: the same `adminKeys.people()` entry five
    // sections share, so it carries the list TTL like every other reader.
    staleTime: ADMIN_STALE_MS,
  });
  const detail = useQuery<PersonDetailResponse>({
    queryKey: adminKeys.person(selectedId ?? ""),
    queryFn: () => fetchPersonDetail(selectedId!),
    select: normalizePersonDetail,
    enabled: !!selectedId,
    staleTime: ADMIN_DETAIL_STALE_MS,
  });
  // The receipt names exactly the persisted change the response carried; the
  // API is authoritative for the record it saved.
  const updatePerson = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateAdminPerson(body),
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.people() });
      void queryClient.invalidateQueries({ queryKey: adminKeys.person(selectedId ?? "") });
      const name = String(result?.person?.display_name ?? detail.data?.person.display_name ?? "The person");
      if (typeof variables.active === "boolean") {
        const message = `${name} is now ${variables.active ? "active" : "inactive"} for planning and evidence.`;
        setReceipt(message);
        notifications.success(message, variables.active ? "Person activated" : "Person deactivated");
        return;
      }
      if ("role_profile_id" in variables) {
        const roleId = variables.role_profile_id == null ? "" : String(variables.role_profile_id);
        const role = roleId ? roster.data?.roleProfiles.find((profile) => profile.id === roleId)?.name ?? null : null;
        const message = role
          ? `${name} is now mapped to ${role}.`
          : roleId
            ? `${name}'s role profile was updated.`
            : `${name} is now unmapped from any role profile.`;
        setReceipt(message);
        notifications.success(message, "Role profile updated");
      }
    },
  });

  const statusById = useMemo(() => {
    const map = new Map<string, AdminOverview["people"][number]>();
    for (const person of overview.data?.people ?? []) map.set(person.personId, person);
    return map;
  }, [overview.data]);

  const roleOptions = (roster.data?.roleProfiles ?? []).map((profile) => ({ value: profile.id, label: profile.name }));
  const people = (roster.data?.people ?? []).filter((person) => {
    const status = statusById.get(String(person.id));
    if (roleFilter === "unmapped" ? !!person.role_profile_id : roleFilter && String(person.role_profile_id ?? "") !== roleFilter) return false;
    if (attendance !== "all" && (status?.attendance.state ?? "unknown") !== attendance) return false;
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return [String(person.display_name ?? ""), String(person.email ?? ""), status?.roleProfile ?? ""].some((value) => value.toLowerCase().includes(needle));
  });

  const selectedStatus = selectedId ? statusById.get(selectedId) ?? null : null;

  const today = todayIso();
  const personRecord = detail.data;
  const todayReport = personRecord ? reportForDay(personRecord.reports, today) : null;
  const todayRecaps = personRecord ? recapsForDay(personRecord.intervals, today) : [];
  const workdays = personRecord ? buildPersonWorkdays(personRecord.sessions, personRecord.recapDays ?? [], 8) : [];
  const todayWorkday = workdays.find((workday) => workday.date === today) ?? null;
  const observedSeconds = todayWorkday?.observedSeconds ?? selectedStatus?.session?.observedSeconds ?? 0;
  const personTimezone = String(personRecord?.schedules?.[0]?.timezone ?? "UTC");
  const openSection = (section: AdminSection, focus?: AdminSectionFocus) => onOpenSection?.(section, focus);
  const openReport = (reportId: string) => {
    if (onOpenSection && personRecord?.person.id) openSection("review", { reportId, personId: personRecord.person.id });
    else onOpenReport?.(reportId);
  };

  return (
    <div className="admin-grid">
      <AdminCard icon={Users} title="Roster" detail={`${people.length} of ${roster.data?.people?.length ?? 0} teammates shown · select a person to open their record`} padded={false}
        controls={
          <AdminControls>
            <AdminControlsGroup>
              <label className="admin-search">
                <Search size={14} aria-hidden />
                <input type="search" value={search} placeholder="Search people" aria-label="Search people" onChange={(event) => setSearch(event.target.value)} />
              </label>
            </AdminControlsGroup>
            <AdminControlsGroup>
              <SelectField ariaLabel="Filter by role profile" value={roleFilter} onChange={setRoleFilter} placeholder="All roles" options={[...roleOptions, { value: "unmapped", label: "Unmapped" }]} />
            </AdminControlsGroup>
            <AdminControlsGroup>
              <Segmented<AttendanceFilter>
                ariaLabel="Filter by attendance"
                value={attendance}
                onChange={setAttendance}
                options={[
                  { value: "all", label: "All" },
                  { value: "active", label: "On shift" },
                  { value: "paused", label: "Paused" },
                  { value: "off_shift", label: "Off shift" },
                  { value: "unknown", label: "Not observed" },
                ]}
              />
            </AdminControlsGroup>
          </AdminControls>
        }
      >
        {overview.isLoading || roster.isLoading ? (
          <div className="admin-card-body is-padded"><div className="admin-grid"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div></div>
        ) : overview.error || roster.error ? (
          <div className="admin-card-body is-padded"><Notice tone="err">{((overview.error || roster.error) as Error).message}</Notice></div>
        ) : people.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr><th>Person</th><th>Role profile</th><th>Schedule</th><th>Status now</th><th>Today</th><th>EOD</th><th>Last recap</th></tr>
              </thead>
              <tbody>
                {people.map((person) => {
                  const personId = String(person.id);
                  const status = statusById.get(personId);
                  return (
                    <tr key={personId} onClick={() => setSelectedId(personId)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(personId); }}>
                      <td>
                        <span className="admin-person">
                          <Avatar name={String(person.display_name ?? "Unknown")} size={30} />
                          <span className="min-w-0">
                            <b>{String(person.display_name ?? "Unknown")}</b>
                            <small>{person.email ? String(person.email) : "No email"}</small>
                          </span>
                        </span>
                      </td>
                      <td>{status?.roleProfile ?? (person.role_profile_id ? "Mapped" : "Unmapped")}</td>
                      <td className="admin-quiet">{status?.schedule ? `${status.schedule.start}–${status.schedule.end} ${status.schedule.timezone}` : "No schedule"}</td>
                      <td>
                        <Pill tone={attendanceTone(status?.attendance.state ?? "unknown")}>
                          {attendanceLabel(status?.attendance.state ?? "unknown")}{status?.attendance.freshness === "stale" ? " · stale" : ""}
                        </Pill>
                      </td>
                      <td className="admin-numeric">
                        {status ? `${status.recapsToday} recap${status.recapsToday === 1 ? "" : "s"} · ${status.tasksCompletedToday} done${status.evidenceToday ? ` · ${status.evidenceToday} evidence` : ""}` : "—"}
                      </td>
                      <td>
                        {status?.eodToday
                          ? <Pill tone={reportTone(status.eodToday)}>{statusLabel(status.eodToday)}</Pill>
                          : <span className="admin-quiet">—</span>}
                      </td>
                      <td className="admin-quiet">{status?.lastRecapAt ? relativeTime(status.lastRecapAt) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-card-body is-padded">
            <Empty
              title={roster.data?.people?.length ? "No people match these filters" : "No people yet"}
              body={roster.data?.people?.length ? "Clear the search or filters to see the full roster." : "People are created through onboarding or membership mapping in Settings."}
            />
          </div>
        )}
      </AdminCard>

      <Drawer
        open={!!selectedId}
        onClose={() => { setSelectedId(null); setReceipt(null); }}
        title={detail.data?.person?.display_name ?? selectedStatus?.displayName ?? "Person"}
        subtitle={detail.data?.person?.email ?? selectedStatus?.email ?? undefined}
        width={640}
      >
        {detail.isLoading ? (
          <div className="admin-grid"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
        ) : detail.error || !detail.data?.person ? (
          <Notice tone="err">{((detail.error as Error | null)?.message) ?? "The person record could not be loaded."}</Notice>
        ) : (
          <div className="admin-grid admin-drawer-grid admin-person-record">
            <section className="admin-block">
              <h3><ShieldCheck size={14} aria-hidden /> Mappings</h3>
              <div className="admin-kv-grid">
                <KeyValue label="Nifty member" value={detail.data.person.nifty_member_id ?? "Not mapped"} mono />
                <KeyValue label="Worktivity employee" value={detail.data.person.worktivity_employee_id ?? "Not mapped"} mono />
                <KeyValue label="Role profile" value={detail.data.person.role_profile?.name ?? "Unmapped"} />
                <KeyValue label="Status" value={detail.data.person.active ? "Active" : "Inactive"} />
              </div>
              <div className="admin-inline-fields">
                <SelectField
                  label="Role profile"
                  ariaLabel="Set role profile"
                  value={detail.data.person.role_profile_id ?? ""}
                  onChange={(next) => updatePerson.mutate({ id: detail.data!.person.id, role_profile_id: next || null })}
                  options={roleOptions}
                  placeholder="Unmapped"
                />
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={detail.data.person.active}
                    onChange={(event) => updatePerson.mutate({ id: detail.data!.person.id, active: event.target.checked })}
                  />
                  Active for planning and evidence
                </label>
              </div>
              {updatePerson.error ? <Notice tone="err">{(updatePerson.error as Error).message}</Notice> : null}
              {receipt ? <Notice tone="ok">{receipt}</Notice> : null}
              {detail.data.teams.length ? (
                <div className="admin-chips">
                  {detail.data.teams.map((membership) => (
                    <Pill key={membership.team_id}>{membership.team?.name ?? "Team"}{membership.is_manager ? " · manager" : ""}</Pill>
                  ))}
                </div>
              ) : null}
            </section>

            <section className="admin-block">
              <h3><CalendarClock size={14} aria-hidden /> Today</h3>
              <div className="admin-today-grid">
                <div className="admin-kv">
                  <span>Status now</span>
                  <b>{selectedStatus ? `${attendanceLabel(selectedStatus.attendance.state)}${selectedStatus.attendance.freshness === "stale" ? " · stale" : ""}` : "Not observed"}</b>
                </div>
                <div className="admin-kv">
                  <span>Observed time</span>
                  <b>{selectedStatus?.session || todayWorkday ? formatDuration(observedSeconds) : "No session"}</b>
                </div>
                <Measure
                  label="Updates"
                  value={String(Math.max(selectedStatus?.recapsToday ?? 0, todayRecaps.length))}
                  onOpen={onOpenRecaps}
                  actionLabel="Open recaps in Admin Otto"
                />
                <Measure
                  label="Outcomes"
                  value={selectedStatus ? String(selectedStatus.tasksCompletedToday) : "—"}
                  onOpen={personRecord?.person.id ? () => openSection("tasks", { personId: personRecord.person.id, taskView: "completed" }) : undefined}
                  actionLabel="Open completed tasks for this person"
                />
                <Measure
                  label="Evidence"
                  value={selectedStatus ? String(selectedStatus.evidenceToday) : "—"}
                  onOpen={personRecord?.person.id ? () => openSection("evidence", { personId: personRecord.person.id }) : undefined}
                  actionLabel="Open evidence for this person"
                />
                <Measure
                  label="EOD"
                  value={todayReport ? statusLabel(String(todayReport.status ?? "draft")) : "—"}
                  onOpen={todayReport ? () => openReport(String(todayReport.id)) : undefined}
                  actionLabel="Open today's EOD report"
                />
              </div>
            </section>

            <section className="admin-block">
              <h3><CalendarClock size={14} aria-hidden /> Schedule</h3>
              {detail.data.schedules.length ? (
                <ul className="admin-rows">
                  {detail.data.schedules.slice(0, 4).map((schedule, index) => (
                    <li key={index}>
                      <span>{String(schedule.shift_start ?? schedule.start ?? "").slice(0, 5)}–{String(schedule.shift_end ?? schedule.end ?? "").slice(0, 5)}</span>
                      <small>{String(schedule.timezone ?? "")} · from {formatWorkOsFullDate(String(schedule.effective_from ?? ""))}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty-note">No schedule is mapped. Planning falls back to the workspace timezone.</p>
              )}
              {detail.data.exceptions.length ? (
                <p className="admin-quiet">{detail.data.exceptions.length} schedule exception{detail.data.exceptions.length === 1 ? "" : "s"} on record.</p>
              ) : null}
            </section>

            <section className="admin-block">
              <h3><CalendarClock size={14} aria-hidden /> Recent workdays</h3>
              {workdays.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table compact">
                    <thead><tr><th>Day</th><th>State</th><th>Observed</th><th>Updates</th></tr></thead>
                    <tbody>
                      {workdays.map((workday) => (
                        <tr key={workday.date} className="static">
                          <td>{formatWorkOsFullDate(workday.date)}</td>
                          <td>{statusLabel(workday.state)}</td>
                          <td className="admin-numeric">{workday.observedSeconds ? formatDuration(workday.observedSeconds) : "—"}</td>
                          <td className="admin-numeric" title={workday.recapCount ? `${workday.recapCount} recap${workday.recapCount === 1 ? "" : "s"} · ${workday.recapReviewed} reviewed` : "No recaps"}>
                            {workday.recapCount ? String(workday.recapCount) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="admin-empty-note">No workdays have been recorded for this person yet.</p>
              )}
            </section>

            <section className="admin-block">
              <h3><MessageSquareText size={14} aria-hidden /> Updates</h3>
              <p className="admin-quiet">Interval recaps recorded today. Open Admin Otto to confirm or correct one.</p>
              {todayRecaps.length ? (
                <ul className="admin-recap-items">
                  {todayRecaps.slice(0, 4).map((recap, index) => {
                    const timezone = String(recap.timezone ?? personTimezone);
                    const start = formatWorkOsTime(String(recap.window_start ?? ""), timezone, "");
                    const end = formatWorkOsTime(String(recap.window_end ?? ""), timezone, "");
                    const timeLabel = start && end ? `${start}–${end}` : end || start || "Recap";
                    const detailText = String(recap.headline ?? recap.final_detail ?? recap.ai_detail ?? "").trim() || "No recap detail recorded.";
                    const reviewStatus = String(recap.review_status ?? "inferred");
                    return (
                      <li key={String(recap.id ?? index)}>
                        <div className="admin-recap-head">
                          <b>{timeLabel}</b>
                          <Pill tone={reviewStatus === "confirmed" ? "ok" : reviewStatus === "amended" ? "info" : "neutral"}>{recapReviewLabel(recap.review_status)}</Pill>
                        </div>
                        <p title={detailText}>{detailText}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="admin-empty-note">No recaps recorded today.</p>
              )}
              {onOpenRecaps ? <button type="button" className="admin-block-action" onClick={onOpenRecaps}>View all recaps</button> : null}
            </section>

            <section className="admin-block">
              <h3><FileCheck2 size={14} aria-hidden /> Reports</h3>
              {detail.data.reports.length ? (
                <ul className="admin-rows spaced admin-report-list">
                  {detail.data.reports.slice(0, 6).map((report, index) => {
                    const reportId = String(report.id ?? "");
                    const reportDate = formatWorkOsFullDate(String(report.report_date ?? ""), "Report");
                    const status = String(report.status ?? "draft");
                    return (
                      <li key={reportId || index}>
                        <button
                          type="button"
                          className="admin-report-row"
                          aria-label={`Open EOD report for ${reportDate}: ${statusLabel(status)}`}
                          onClick={() => reportId && openReport(reportId)}
                        >
                          <span>{reportDate}</span>
                          <span className="admin-report-meta">
                            <small>{report.submitted_at ? `submitted ${relativeTime(String(report.submitted_at))}` : "not submitted"}</small>
                            <Pill tone={reportTone(status)}>{statusLabel(status)}</Pill>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="admin-empty-note">No EOD reports for this person yet.</p>
              )}
              <button
                type="button"
                className="admin-block-action"
                onClick={() => personRecord?.person.id && openSection("review", { personId: personRecord.person.id })}
              >
                View all reports
              </button>
            </section>

            <section className="admin-block">
              <h3><ShieldCheck size={14} aria-hidden /> Evidence (7 days)</h3>
              <div className="admin-kv-grid">
                <KeyValue label="Total" value={String(detail.data.evidenceSummary.total)} />
                <KeyValue label="Activity" value={String(detail.data.evidenceSummary.activity)} />
                <KeyValue label="Output" value={String(detail.data.evidenceSummary.output)} />
                <KeyValue label="Disputed" value={String(detail.data.evidenceSummary.disputed)} />
              </div>
              <p className="admin-quiet">Observed activity is neutral context; raw frames stay behind the flagged/disputed review rule.</p>
            </section>
          </div>
        )}
      </Drawer>
    </div>
  );
}

/** One Today measure. A value the drawer can open is a real underlined control;
 * a value with no honest destination stays a quiet fact. */
function Measure({ label, value, onOpen, actionLabel }: { label: string; value: string; onOpen?: () => void; actionLabel?: string }) {
  const body = <><span>{label}</span><b>{value}</b></>;
  return onOpen
    ? <button type="button" className="admin-kv admin-kv-link" aria-label={`${actionLabel ?? label}: ${value}`} onClick={onOpen}>{body}</button>
    : <div className="admin-kv">{body}</div>;
}

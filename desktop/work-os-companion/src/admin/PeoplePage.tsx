import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, FileCheck2, MessageSquareText, Search, ShieldCheck, Users } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import { ActivityDetailDrawer, activityRecordFromUpdate, updateText, type ActivityDetailRecord } from "./ActivityDetail";
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
import { AdminButton, AdminCard, AdminControls, AdminControlsGroup, Avatar, Drawer, Empty, KeyValue, Notice, Pill, Segmented, SelectField, Skeleton, TextField } from "./ui";
import type { AdminOverview, PersonDetailResponse } from "./types";

type AttendanceFilter = "all" | "active" | "paused" | "off_shift" | "unknown";

/** The roster: every mapped person with today's recorded state, and a drawer
 * that carries the person's own record — mappings, schedule, workdays,
 * reports, updates, and the evidence summary behind their row. A recorded
 * update opens its own full-record drawer above the person record. */
export default function PeoplePage({ initialPersonId, onOpenReport }: { initialPersonId?: string; onOpenReport?: (reportId: string) => void }) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [attendance, setAttendance] = useState<AttendanceFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialPersonId ?? null);
  const [updateRecord, setUpdateRecord] = useState<ActivityDetailRecord | null>(null);
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
    staleTime: ADMIN_DETAIL_STALE_MS,
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

  // A recorded update can point at its workday's EOD report when one is on
  // file, so the update drawer can offer a real "Open EOD review" action.
  const reportIdByDate = useMemo(() => {
    const map = new Map<string, string>();
    for (const report of detail.data?.reports ?? []) {
      const date = String(report.report_date ?? "");
      const id = String(report.id ?? "");
      if (date && id) map.set(date, id);
    }
    return map;
  }, [detail.data]);

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
                <tr><th>Person</th><th>Role profile</th><th>Schedule</th><th>Status now</th><th>Today</th><th>EOD</th><th>Last update</th></tr>
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
                        {status ? `${status.updatesToday} update${status.updatesToday === 1 ? "" : "s"} · ${status.tasksCompletedToday} done${status.evidenceToday ? ` · ${status.evidenceToday} evidence` : ""}` : "—"}
                      </td>
                      <td>
                        {status?.eodToday
                          ? <Pill tone={reportTone(status.eodToday)}>{statusLabel(status.eodToday)}</Pill>
                          : status?.eodOutstanding ? <Pill tone="warn">Outstanding</Pill> : <span className="admin-quiet">—</span>}
                      </td>
                      <td className="admin-quiet">{status?.lastUpdateAt ? relativeTime(status.lastUpdateAt) : "—"}</td>
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
        onClose={() => { setSelectedId(null); setUpdateRecord(null); setReceipt(null); }}
        title={detail.data?.person?.display_name ?? selectedStatus?.displayName ?? "Person"}
        subtitle={detail.data?.person?.email ?? selectedStatus?.email ?? undefined}
        width={600}
      >
        {detail.isLoading ? (
          <div className="admin-grid"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
        ) : detail.error || !detail.data?.person ? (
          <Notice tone="err">{((detail.error as Error | null)?.message) ?? "The person record could not be loaded."}</Notice>
        ) : (
          <div className="admin-grid admin-drawer-grid">
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
              <div className="admin-kv-grid">
                <KeyValue label="Status now" value={selectedStatus ? `${attendanceLabel(selectedStatus.attendance.state)}${selectedStatus.attendance.freshness === "stale" ? " · stale" : ""}` : "Not observed"} />
                <KeyValue label="Observed time" value={selectedStatus?.session ? formatDuration(selectedStatus.session.observedSeconds) : "No session"} />
                <KeyValue label="Updates" value={String(selectedStatus?.updatesToday ?? 0)} />
                <KeyValue label="Outcomes" value={String(selectedStatus?.tasksCompletedToday ?? 0)} />
                <KeyValue label="Evidence" value={String(selectedStatus?.evidenceToday ?? 0)} />
                <KeyValue label="EOD" value={selectedStatus?.eodToday ? statusLabel(selectedStatus.eodToday) : selectedStatus?.eodOutstanding ? "Outstanding" : "—"} />
              </div>
            </section>

            <section className="admin-block">
              <h3><CalendarClock size={14} aria-hidden /> Schedule</h3>
              {detail.data.schedules.length ? (
                <ul className="admin-rows">
                  {detail.data.schedules.slice(0, 4).map((schedule, index) => (
                    <li key={index}>
                      <span>{String(schedule.start ?? "")}–{String(schedule.end ?? "")}</span>
                      <small>{String(schedule.timezone ?? "")} · from {String(schedule.effective_from ?? "—")}</small>
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
              <h3><MessageSquareText size={14} aria-hidden /> Recent workdays</h3>
              {detail.data.sessions.length ? (
                <div className="admin-table-wrap">
                  <table className="admin-table compact">
                    <thead><tr><th>Day</th><th>State</th><th>Observed</th><th>Updates</th></tr></thead>
                    <tbody>
                      {detail.data.sessions.slice(0, 6).map((session, index) => (
                        <tr key={index} className="static">
                          <td>{String(session.shift_date ?? "—")}</td>
                          <td>{statusLabel(String(session.state ?? "unknown"))}</td>
                          <td className="admin-numeric">{Number(session.observed_seconds ?? 0) ? formatDuration(Number(session.observed_seconds ?? 0)) : "—"}</td>
                          <td className="admin-numeric">{String(session.updates ?? session.update_count ?? "—")}</td>
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
              {detail.data.updates.length ? (
                <ul className="admin-rows">
                  {detail.data.updates.slice(0, 6).map((update, index) => {
                    const at = String(update.occurred_at ?? update.created_at ?? "");
                    const reportId = reportIdByDate.get(String(update.shift_date ?? at).slice(0, 10)) ?? null;
                    return (
                      <li key={String(update.id ?? index)}>
                        <button
                          type="button"
                          onClick={() => setUpdateRecord(activityRecordFromUpdate(update, { id: detail.data!.person.id, name: detail.data!.person.display_name }, reportId))}
                        >
                          <span>{updateText(update) ?? "Update"}</span>
                          <small>{statusLabel(String(update.update_kind ?? update.kind ?? "update"))} · {relativeTime(at)}</small>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="admin-empty-note">No recorded updates for this person yet.</p>
              )}
            </section>

            <section className="admin-block">
              <h3><FileCheck2 size={14} aria-hidden /> Reports</h3>
              {detail.data.reports.length ? (
                <ul className="admin-rows">
                  {detail.data.reports.slice(0, 6).map((report, index) => (
                    <li key={index}>
                      <span>{String(report.report_date ?? "Report")}</span>
                      <Pill tone={reportTone(String(report.status ?? "draft"))}>{statusLabel(String(report.status ?? "draft"))}</Pill>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="admin-empty-note">No EOD reports for this person yet.</p>
              )}
              <p className="admin-quiet">Review reports from the EOD Review section.</p>
            </section>

            <section className="admin-block">
              <h3><ShieldCheck size={14} aria-hidden /> Evidence summary</h3>
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

      <ActivityDetailDrawer
        record={updateRecord}
        onClose={() => setUpdateRecord(null)}
        onOpenReport={onOpenReport}
      />
    </div>
  );
}

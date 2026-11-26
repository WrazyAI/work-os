import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { currentPayrollWindowForDate, payrollIsStandardWindow, payrollPayDateForThrough, payrollStandardWindow, payrollWindowDayCount } from "@wrazy/work-os-shared/payroll/window";
import { formatWorkOsFullDate } from "../../dateFormat";
import { ADMIN_STALE_MS, formatMinutes, statusLabel } from "../data";
import { AdminButton, AdminCard, AdminControls, AdminControlsGroup, AdminRowsSkeleton, Drawer, Empty, Notice, Pill, Segmented, SelectField, TextField } from "../ui";
import { desktopPayroll, desktopPayrollKey } from "./api";
import { PayrollAuditDetail } from "./PayrollAuditDetail";

type Tab = "records" | "audits";

export function defaultPayDate() {
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return currentPayrollWindowForDate(today).payDate;
}

/** A retry after a transport failure must not queue a second audit. The key is
 * reused only for the same employee and the same window until the server
 * accepts the submission; changing either starts a fresh request. */
export function auditRequestKey(previous: { personId: string; from: string; through: string; key: string } | null, input: {
  personId: string; from: string; through: string;
}) {
  return previous?.personId === input.personId && previous.from === input.from && previous.through === input.through
    ? previous
    : { ...input, key: crypto.randomUUID() };
}

export default function PayrollPage({ organizationId, userId }: { organizationId: string; userId: string }) {
  const [payDate, setPayDate] = useState(defaultPayDate);
  const [draftDate, setDraftDate] = useState(payDate);
  const [tab, setTab] = useState<Tab>("records");
  const [newAudit, setNewAudit] = useState(false);
  const [selection, setSelection] = useState<{ reviewId: string; personId: string; name: string } | null>(null);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const api = desktopPayroll(organizationId);
  const keys = desktopPayrollKey(organizationId, userId);
  const roster = useQuery({
    queryKey: [...keys, "records", payDate, cursor],
    queryFn: ({ signal }) => api.roster(payDate, cursor, true, signal),
    staleTime: ADMIN_STALE_MS,
    retry: false,
  });
  const records = roster.data?.items ?? [];
  const validDate = /^(?!0000)\d{4}-(0[1-9]|1[0-2])-(01|16)$/.test(draftDate);

  if (selection) return <PayrollAuditDetail key={selection.reviewId} organizationId={organizationId} userId={userId} payDate={payDate}
    {...selection} onBack={() => setSelection(null)} />;
  return (
    <div className="admin-grid payroll-native">
      <AdminCard
        title={tab === "records" ? "Records" : "Audits"}
        detail={roster.data ? `${formatWorkOsFullDate(roster.data.period.from)} to ${formatWorkOsFullDate(roster.data.period.through)}` : "Select a pay date to see its records."}
        action={<AdminButton variant="primary" icon={Plus} onClick={() => setNewAudit(true)}>New audit</AdminButton>}
        controls={<AdminControls>
          <AdminControlsGroup>
            <Segmented<Tab> value={tab} onChange={setTab} ariaLabel="Payroll view" options={[{ value: "audits", label: "Audits" }, { value: "records", label: "Records" }]} />
          </AdminControlsGroup>
          <AdminControlsGroup end>
            <form className="admin-inline-fields" onSubmit={(event) => {
              event.preventDefault();
              if (validDate && draftDate !== payDate) { setPayDate(draftDate); setCursors([null]); }
            }}>
              <TextField label="Pay date" type="date" value={draftDate} onChange={setDraftDate} />
              <AdminButton type="submit" disabled={!validDate || draftDate === payDate}>Show period</AdminButton>
            </form>
          </AdminControlsGroup>
        </AdminControls>}
        padded={false}
      >
        {roster.isPending ? <AdminRowsSkeleton label={tab === "records" ? "Loading payroll records" : "Loading payroll audits"} /> : null}
        {roster.error ? <div className="admin-card-body is-padded"><Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void roster.refetch()}>Retry</AdminButton>}>{roster.error.message}</Notice></div> : null}
        {roster.data && records.length === 0 ? <Empty title={tab === "records" ? "No payroll records for this pay date" : "No audits for this pay date"} body="Choose another pay date or start a new audit." /> : null}
        {records.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table payroll-records-table">
              <thead><tr><th scope="col">Employee</th><th scope="col">Review status</th>{tab === "records"
                ? <><th scope="col">Recommended</th><th scope="col">Approved</th></>
                : <th scope="col">Analysis</th>}<th scope="col" className="actions">Open</th></tr></thead>
              <tbody>{records.map((row) => {
                const open = row.reviewId
                  ? () => setSelection({ reviewId: row.reviewId!, personId: row.personId, name: row.displayName })
                  : undefined;
                return (
                  <tr key={row.personId} className={open ? "payroll-open-row" : undefined} onClick={open}>
                    <td data-label="Employee">
                      <b>{row.displayName}</b>
                      {row.active ? null : <small className="admin-quiet"> Inactive</small>}
                    </td>
                    <td data-label="Review status"><Pill tone={row.status === "approved" ? "ok" : row.status === "needs_review" ? "warn" : "neutral"}>{statusLabel(row.status)}</Pill></td>
                    {tab === "records" ? <>
                      <td data-label="Recommended">{row.status === "draft" || row.status === "failed" ? "—" : formatMinutes(row.totals.recommended)}</td>
                      <td data-label="Approved">{row.status === "approved" ? formatMinutes(row.totals.approved) : "—"}</td>
                    </> : <td data-label="Analysis">{row.auditStatus ? statusLabel(row.auditStatus) : "Not available"}</td>}
                    <td data-label="Open" className="actions">
                      {open ? <button type="button" className="admin-record-open"
                        aria-label={`Open ${row.displayName} payroll review`}
                        onClick={(event) => { event.stopPropagation(); open(); }}>
                        {tab === "records" ? "Open review" : "Open audit"}
                      </button> : null}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : null}
        {roster.data && (cursors.length > 1 || roster.data.nextCursor) ? <div className="admin-card-body is-padded">
          <AdminControls>
            <AdminControlsGroup>
              <span className="admin-quiet" role="status">Showing {records.length} of {roster.data.total} records</span>
              <AdminButton disabled={cursors.length === 1} onClick={() => setCursors((current) => current.slice(0, -1))}>Previous</AdminButton>
              <AdminButton disabled={!roster.data.nextCursor} onClick={() => { if (roster.data?.nextCursor) setCursors((current) => [...current, roster.data!.nextCursor]); }}>Next</AdminButton>
            </AdminControlsGroup>
          </AdminControls>
        </div> : null}
      </AdminCard>
      {!validDate ? <p className="admin-quiet">Use the first or sixteenth of the month.</p> : null}
      {newAudit ? <NewPayrollAudit organizationId={organizationId} userId={userId} payDate={payDate} onClose={() => setNewAudit(false)} onStarted={(record) => {
        setNewAudit(false);
        setTab("audits");
        setSelection(record);
      }} /> : null}
    </div>
  );
}

function NewPayrollAudit({ organizationId, userId, payDate, onClose, onStarted }: {
  organizationId: string; userId: string; payDate: string; onClose: () => void;
  onStarted: (record: { reviewId: string; personId: string; name: string }) => void;
}) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const standard = payrollStandardWindow(payDate);
  const [personId, setPersonId] = useState("");
  const [from, setFrom] = useState(standard.from);
  const [through, setThrough] = useState(standard.through < todayKey ? standard.through : todayKey);
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const windowError = !from || !through ? "Choose a start and end date."
    : from > through ? "The end date must not precede the start date."
      : through > todayKey ? "The end date cannot be in the future."
        : from > todayKey ? "The start date cannot be in the future."
          : payrollWindowDayCount(from, through) > 31 ? "Choose a window of 31 days or fewer."
            : null;
  const request = useRef<{ personId: string; from: string; through: string; key: string } | null>(null);
  const cache = useQueryClient();
  const api = desktopPayroll(organizationId);
  const keys = desktopPayrollKey(organizationId, userId);
  const effectivePayDate = /^\d{4}-\d{2}-\d{2}$/.test(through) ? payrollPayDateForThrough(through) : payDate;
  const cursor = pages.at(-1) ?? null;
  const roster = useQuery({
    queryKey: [...keys, "candidates", effectivePayDate, cursor],
    queryFn: ({ signal }) => api.roster(effectivePayDate, cursor, false, signal),
    staleTime: ADMIN_STALE_MS,
    retry: false,
  });
  const standardRequest = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(through)
    ? payrollIsStandardWindow(effectivePayDate, from, through)
    : true;
  const candidates = roster.data?.items.filter((row) => row.active && row.mapped && (row.status !== "approved" || !standardRequest)) ?? [];
  const selected = candidates.find((person) => personId === person.personId);
  useEffect(() => { setPages([null]); setPersonId(""); }, [effectivePayDate]);
  const start = useMutation({
    mutationFn: async (person: { personId: string; displayName: string }) => {
      request.current = auditRequestKey(request.current, { personId: person.personId, from, through });
      const run = await api.start({ personId: person.personId, payDate: effectivePayDate, from, through, requestKey: request.current.key });
      return { reviewId: run.reviewId, personId: person.personId, name: person.displayName };
    },
    onSuccess: (record) => {
      request.current = null;
      void cache.invalidateQueries({ queryKey: keys });
      onStarted(record);
    },
  });
  return (
    <Drawer open onClose={() => { if (!start.isPending) onClose(); }} title="New audit" subtitle={through ? `Pay date ${formatWorkOsFullDate(effectivePayDate)}` : "Choose a review window"}
      footer={<>
        <AdminButton onClick={onClose} disabled={start.isPending}>Cancel</AdminButton>
        <AdminButton variant="primary" disabled={!selected || start.isPending || Boolean(windowError)} onClick={() => { if (selected) start.mutate(selected); }}>
          {start.isPending ? "Starting audit…" : "Run audit"}
        </AdminButton>
      </>}>
      <div className="admin-grid">
        <p className="admin-quiet">Choose the window to review. It defaults to this pay period through today when the period is incomplete. Running an audit does not approve hours.</p>
        {roster.isPending ? <AdminRowsSkeleton label="Loading eligible employees" leading rows={3} /> : null}
        {roster.error ? <Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void roster.refetch()}>Retry</AdminButton>}>{roster.error.message}</Notice> : null}
        {roster.data && !candidates.length ? <Empty title="No eligible employees on this page" body="The employee needs an active, verified mapping and an unapproved period." /> : null}
        {candidates.length ? <fieldset disabled={start.isPending}>
          <SelectField label="Employee" placeholder="Choose an employee" value={personId} onChange={setPersonId} options={candidates.map((person) => ({ value: person.personId, label: person.displayName }))} />
        </fieldset> : null}
        <div className="admin-inline-fields">
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="Through" type="date" value={through} onChange={setThrough} />
        </div>
        <p className="admin-quiet">Reviewing {from || "…"} to {through || "…"}. Pay date {through ? payrollPayDateForThrough(through) : "…"}.</p>
        {windowError ? <Notice tone="warn">{windowError}</Notice> : null}
        {roster.data && (pages.length > 1 || roster.data.nextCursor) ? <AdminControls>
          <span className="admin-quiet" role="status">Showing {candidates.length} of {roster.data.total} employees</span>
          <AdminButton disabled={start.isPending || pages.length === 1} onClick={() => { setPersonId(""); setPages((current) => current.slice(0, -1)); }}>Previous</AdminButton>
          <AdminButton disabled={start.isPending || !roster.data.nextCursor} onClick={() => {
            const next = roster.data?.nextCursor;
            if (next) { setPersonId(""); setPages((current) => [...current, next]); }
          }}>Next</AdminButton>
        </AdminControls> : null}
        {start.error ? <Notice tone="err">{start.error.message}</Notice> : null}
      </div>
    </Drawer>
  );
}

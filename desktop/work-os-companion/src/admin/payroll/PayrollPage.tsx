import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { formatWorkOsFullDate } from "../../dateFormat";
import { ADMIN_STALE_MS, formatMinutes, statusLabel } from "../data";
import { AdminButton, AdminCard, AdminControls, AdminControlsGroup, Drawer, Empty, Notice, Pill, Segmented, SelectField, TextField } from "../ui";
import { desktopPayroll, desktopPayrollKey } from "./api";
import { PayrollAuditDetail } from "./PayrollAuditDetail";

type Tab = "records" | "audits";

export function defaultPayDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getDate() >= 16 ? "16" : "01"}`;
}

/** A retry after a transport failure must not queue a second audit. The key is
 * reused only for the same employee until the server accepts the submission;
 * changing the employee starts a fresh request. */
export function auditRequestKey(previous: { personId: string; key: string } | null, personId: string) {
  return previous?.personId === personId ? previous : { personId, key: crypto.randomUUID() };
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
        {roster.isPending ? <p className="admin-card-body is-padded admin-quiet" role="status">Loading payroll records…</p> : null}
        {roster.error ? <div className="admin-card-body is-padded"><Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void roster.refetch()}>Retry</AdminButton>}>{roster.error.message}</Notice></div> : null}
        {roster.data && records.length === 0 ? <Empty title={tab === "records" ? "No payroll records for this pay date" : "No audits for this pay date"} body="Choose another pay date or start a new audit." /> : null}
        {records.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th scope="col">Employee</th><th scope="col">Review status</th>{tab === "records"
                ? <><th scope="col">Recommended</th><th scope="col">Approved</th></>
                : <th scope="col">Analysis</th>}</tr></thead>
              <tbody>{records.map((row) => (
                <tr key={row.personId}>
                  <td data-label="Employee">
                    {row.reviewId ? <button type="button" className="admin-record-open"
                      aria-label={`Open ${row.displayName} payroll review`}
                      onClick={() => setSelection({ reviewId: row.reviewId!, personId: row.personId, name: row.displayName })}>{row.displayName}</button>
                      : <b>{row.displayName}</b>}
                    {row.active ? null : <small className="admin-quiet"> Inactive</small>}
                  </td>
                  <td data-label="Review status"><Pill tone={row.status === "approved" ? "ok" : row.status === "needs_review" ? "warn" : "neutral"}>{statusLabel(row.status)}</Pill></td>
                  {tab === "records" ? <>
                    <td data-label="Recommended">{row.status === "draft" || row.status === "failed" ? "—" : formatMinutes(row.totals.recommended)}</td>
                    <td data-label="Approved">{row.status === "approved" ? formatMinutes(row.totals.approved) : "—"}</td>
                  </> : <td data-label="Analysis">{row.auditStatus ? statusLabel(row.auditStatus) : "Not available"}</td>}
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
        {roster.data && (cursors.length > 1 || roster.data.nextCursor) ? <div className="admin-card-body is-padded">
          <AdminControls>
            <AdminControlsGroup>
              <span className="admin-quiet" role="status">Page {cursors.length} of payroll records</span>
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
  const [personId, setPersonId] = useState("");
  const [pages, setPages] = useState<(string | null)[]>([null]);
  const request = useRef<{ personId: string; key: string } | null>(null);
  const cache = useQueryClient();
  const api = desktopPayroll(organizationId);
  const keys = desktopPayrollKey(organizationId, userId);
  const cursor = pages.at(-1) ?? null;
  const roster = useQuery({
    queryKey: [...keys, "candidates", payDate, cursor],
    queryFn: ({ signal }) => api.roster(payDate, cursor, false, signal),
    staleTime: ADMIN_STALE_MS,
    retry: false,
  });
  const candidates = roster.data?.items.filter((row) => row.active && row.mapped && row.status !== "approved") ?? [];
  const selected = candidates.find((person) => personId === person.personId);
  const start = useMutation({
    mutationFn: async (person: { personId: string; displayName: string }) => {
      request.current = auditRequestKey(request.current, person.personId);
      const run = await api.start({ personId: person.personId, payDate, requestKey: request.current.key });
      return { reviewId: run.reviewId, personId: person.personId, name: person.displayName };
    },
    onSuccess: (record) => {
      request.current = null;
      void cache.invalidateQueries({ queryKey: keys });
      onStarted(record);
    },
  });
  return (
    <Drawer open onClose={() => { if (!start.isPending) onClose(); }} title="New audit" subtitle={`Pay date ${formatWorkOsFullDate(payDate)}`}
      footer={<>
        <AdminButton onClick={onClose} disabled={start.isPending}>Cancel</AdminButton>
        <AdminButton variant="primary" disabled={!selected || start.isPending} onClick={() => { if (selected) start.mutate(selected); }}>
          {start.isPending ? "Queueing audit…" : "Run audit"}
        </AdminButton>
      </>}>
      <div className="admin-grid">
        <p className="admin-quiet">Review evidence for this pay period. Running an audit does not approve hours.</p>
        {roster.isPending ? <p role="status">Loading eligible employees…</p> : null}
        {roster.error ? <Notice tone="err" action={<AdminButton variant="ghost" onClick={() => void roster.refetch()}>Retry</AdminButton>}>{roster.error.message}</Notice> : null}
        {roster.data && !candidates.length ? <Empty title="No eligible employees on this page" body="The employee needs an active, verified mapping and an unapproved period." /> : null}
        {candidates.length ? <fieldset disabled={start.isPending}>
          <SelectField label="Employee" placeholder="Choose an employee" value={personId} onChange={setPersonId} options={candidates.map((person) => ({ value: person.personId, label: person.displayName }))} />
        </fieldset> : null}
        {roster.data && (pages.length > 1 || roster.data.nextCursor) ? <AdminControls>
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

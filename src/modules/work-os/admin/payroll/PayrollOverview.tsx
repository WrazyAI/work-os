"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { payrollApi, payrollKeys } from "./api";
import { PayrollOverviewView } from "./PayrollOverviewView";
import { isPayrollPayDate, payrollReviewHref, payrollWorkspaceHref } from "./paths";

function duePayDate(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${now.getUTCDate() >= 16 ? "16" : "01"}`;
}

export default function PayrollOverview({ tab, newAudit, initialPayDate }: {
  tab: "records" | "audits"; newAudit: boolean; initialPayDate?: string;
}) {
  const router = useRouter();
  const cache = useQueryClient();
  const payDate = initialPayDate ?? duePayDate();
  const [dateInput, setDateInput] = useState(payDate);
  const [search, setSearch] = useState("");
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ personId: string; key: string } | null>(null);
  const roster = useInfiniteQuery({
    queryKey: payrollKeys.rosterPages(payDate, !newAudit),
    queryFn: ({ pageParam }) => payrollApi.roster(payDate, pageParam, !newAudit),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 45_000,
  });
  const page = roster.data?.pages[0];
  const people = roster.data?.pages.flatMap((entry) => entry.items) ?? [];
  const candidates = people.filter((person) => person.active && person.mapped && person.status !== "approved");
  const selected = candidates.find((person) => person.personId === personId);
  const items = people.filter((person) => person.reviewId && person.displayName.toLowerCase().includes(search.trim().toLowerCase()));

  async function startAudit(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    if (request.current?.personId !== selected.personId) {
      request.current = { personId: selected.personId, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError(null);
    try {
      await payrollApi.start(selected.personId, payDate, request.current.key);
      void cache.invalidateQueries({ queryKey: ["work-os", "admin", "payroll"] });
      router.push(payrollReviewHref(selected.personId, payDate));
    } catch (issue) {
      setError((issue as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="payroll-workspace">
      <nav aria-label="Payroll views" className="payroll-workspace-nav payroll-actions">
        <Link aria-current={tab === "audits" ? "page" : undefined} href={payrollWorkspaceHref("audits", payDate)}>Audits</Link>
        <Link aria-current={tab === "records" ? "page" : undefined} href={payrollWorkspaceHref("records", payDate)}>Records</Link>
      </nav>
      <form className="payroll-controls" onSubmit={(event) => {
        event.preventDefault();
        if (isPayrollPayDate(dateInput)) router.push(payrollWorkspaceHref(tab, dateInput, newAudit));
      }}>
        <label>Pay date <input type="date" required value={dateInput} onChange={(event) => setDateInput(event.target.value)} aria-describedby="payroll-date-help" /></label>
        <button type="submit" disabled={busy || dateInput === payDate || !isPayrollPayDate(dateInput)}>Show period</button>
        <p id="payroll-date-help" className="payroll-footnote">Use the 1st or 16th of the month.</p>
      </form>
      {roster.isPending ? <p className="payroll-panel" role="status">Loading payroll…</p> : null}
      {roster.error ? <div className="payroll-blocker" role="alert">{roster.error.message} <button type="button" onClick={() => void roster.refetch()}>Retry</button></div> : null}
      {page && newAudit ? (
        <form className="payroll-panel payroll-audit-form" onSubmit={(event) => void startAudit(event)}>
          <h2>New audit</h2>
          <p>Review recorded evidence for {page.period.from} — {page.period.through}. Running an audit does not approve hours.</p>
          {error ? <p className="payroll-blocker" role="alert">{error}</p> : null}
          <label>Employee <select value={personId} onChange={(event) => setPersonId(event.target.value)} disabled={busy} required>
            <option value="">Choose an employee</option>
            {candidates.map((person) => <option key={person.personId} value={person.personId}>{person.displayName}</option>)}
          </select></label>
          {!candidates.length && !roster.hasNextPage ? <p className="payroll-empty">No eligible employees with a verified mapping for this period.</p> : null}
          <div className="payroll-actions">
            <button type="submit" className="primary" disabled={!selected || busy}>{busy ? "Queueing audit…" : "Run audit"}</button>
            <Link href={payrollWorkspaceHref("audits", payDate)}>Back to audits</Link>
          </div>
        </form>
      ) : null}
      {page && !newAudit ? (
        <>
          <div className="payroll-controls">
            <label>Search <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Employee" /></label>
          </div>
          <PayrollOverviewView page={{ ...page, items, nextCursor: roster.data?.pages.at(-1)?.nextCursor ?? null }} payDate={payDate} tab={tab} filtered={Boolean(search.trim())} />
        </>
      ) : null}
      {roster.hasNextPage ? <div className="payroll-actions">
        <button type="button" disabled={roster.isFetchingNextPage || busy} onClick={() => void roster.fetchNextPage()}>
          {roster.isFetchingNextPage ? "Loading…" : `Load more ${newAudit ? "employees" : "records"} (${people.length} of ${page?.total ?? people.length} loaded)`}
        </button>
      </div> : null}
    </div>
  );
}

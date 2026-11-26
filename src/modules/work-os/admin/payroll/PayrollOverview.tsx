"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { currentPayrollWindowForDate, payrollIsStandardWindow, payrollPayDateForThrough, payrollWindowDayCount } from "@wrazy/work-os-shared/payroll/window";
import { payrollApi, payrollKeys } from "./api";
import { PayrollOverviewView } from "./PayrollOverviewView";
import { isPayrollDate, isPayrollPayDate, payrollDefaultWindow, payrollReviewHref, payrollWorkspaceHref } from "./paths";

function duePayDate(now = new Date()): string {
  return currentPayrollWindowForDate(now.toISOString().slice(0, 10)).payDate;
}

export default function PayrollOverview({ tab, newAudit, initialPayDate }: {
  tab: "records" | "audits"; newAudit: boolean; initialPayDate?: string;
}) {
  const router = useRouter();
  const cache = useQueryClient();
  const payDate = initialPayDate ?? duePayDate();
  const today = new Date().toISOString().slice(0, 10);
  const windowDefault = payrollDefaultWindow(payDate, today);
  const [dateInput, setDateInput] = useState(payDate);
  const [fromInput, setFromInput] = useState(windowDefault.from);
  const [throughInput, setThroughInput] = useState(windowDefault.through);
  const [search, setSearch] = useState("");
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ personId: string; from: string; through: string; key: string } | null>(null);
  const effectivePayDate = isPayrollDate(throughInput) ? payrollPayDateForThrough(throughInput) : payDate;
  const rosterPayDate = newAudit ? effectivePayDate : payDate;
  useEffect(() => { setPersonId(""); }, [rosterPayDate]);
  const roster = useInfiniteQuery({
    queryKey: payrollKeys.rosterPages(rosterPayDate, !newAudit),
    queryFn: ({ pageParam }) => payrollApi.roster(rosterPayDate, pageParam, !newAudit),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 45_000,
  });
  const page = roster.data?.pages[0];
  const people = roster.data?.pages.flatMap((entry) => entry.items) ?? [];
  const standardRequest = isPayrollDate(fromInput) && isPayrollDate(throughInput)
    ? payrollIsStandardWindow(effectivePayDate, fromInput, throughInput)
    : true;
  const candidates = people.filter((person) => person.active && person.mapped && (person.status !== "approved" || !standardRequest));
  const selected = candidates.find((person) => person.personId === personId);
  const items = people.filter((person) => person.reviewId && person.displayName.toLowerCase().includes(search.trim().toLowerCase()));
  const windowError = !fromInput || !throughInput ? "Choose a start and end date."
    : fromInput > throughInput ? "The end date must not precede the start date."
      : throughInput > today ? "The end date cannot be in the future."
        : fromInput > today ? "The start date cannot be in the future."
          : payrollWindowDayCount(fromInput, throughInput) > 31 ? "Choose a window of 31 days or fewer."
            : null;

  async function startAudit(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy || windowError) return;
    const identity = { personId: selected.personId, from: fromInput, through: throughInput };
    if (!request.current || request.current.personId !== identity.personId
      || request.current.from !== identity.from || request.current.through !== identity.through) {
      request.current = { ...identity, key: crypto.randomUUID() };
    }
    setBusy(true);
    setError(null);
    try {
      const run = await payrollApi.start(selected.personId, effectivePayDate, request.current.key, fromInput, throughInput);
      request.current = null;
      void cache.invalidateQueries({ queryKey: ["work-os", "admin", "payroll"] });
      router.push(payrollReviewHref(selected.personId, effectivePayDate, run.reviewId));
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
          <p>Choose the window to review. It defaults to this pay period through today when the period is incomplete. Running an audit does not approve hours.</p>
          {error ? <p className="payroll-blocker" role="alert">{error}</p> : null}
          <label>Employee <select value={personId} onChange={(event) => setPersonId(event.target.value)} disabled={busy} required>
            <option value="">Choose an employee</option>
            {candidates.map((person) => <option key={person.personId} value={person.personId}>{person.displayName}</option>)}
          </select></label>
          <div className="payroll-window-fields">
            <label>From <input type="date" value={fromInput} max={today} onChange={(event) => setFromInput(event.target.value)} disabled={busy} required /></label>
            <label>Through <input type="date" value={throughInput} max={today} onChange={(event) => setThroughInput(event.target.value)} disabled={busy} required /></label>
          </div>
          <p className="payroll-footnote">Reviewing {fromInput || "…"} — {throughInput || "…"}{throughInput ? ` · pay date ${payrollPayDateForThrough(throughInput)}` : ""}</p>
          {windowError ? <p className="payroll-blocker" role="alert">{windowError}</p> : null}
          {!candidates.length && !roster.hasNextPage ? <p className="payroll-empty">No eligible employees with a verified mapping for this period.</p> : null}
          <div className="payroll-actions">
            <button type="submit" className="primary" disabled={!selected || busy || Boolean(windowError)}>{busy ? "Starting audit…" : "Run audit"}</button>
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

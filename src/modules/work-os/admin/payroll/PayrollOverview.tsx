"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { payrollApi, payrollKeys } from "./api";
import { PayrollOverviewView } from "./PayrollOverviewView";

function duePayDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}-${now.getDate() >= 16 ? "16" : "01"}`;
}

export default function PayrollOverview() {
  const [payDate, setPayDate] = useState(duePayDate);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const query = useQuery({ queryKey: payrollKeys.roster(payDate), queryFn: () => payrollApi.roster(payDate) });
  const [options] = useState(() => [duePayDate(), duePayDate(new Date(Date.now() - 16 * 86_400_000))].filter((value, index, all) => all.indexOf(value) === index));
  const filtered = useMemo(() => {
    const items = query.data?.items ?? [];
    return items.filter((item) => (status === "all" || item.status === status)
      && item.displayName.toLowerCase().includes(search.trim().toLowerCase()));
  }, [query.data, search, status]);
  if (query.isLoading) return <div className="payroll-shell"><p className="payroll-empty">Loading payroll roster…</p></div>;
  if (query.error) return <div className="payroll-shell"><p className="payroll-blocker">{(query.error as Error).message}</p></div>;
  if (!query.data) return null;
  return (
    <div>
      <div className="payroll-controls">
        <label>Pay date <select value={payDate} onChange={(event) => setPayDate(event.target.value)}>
          {options.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>Search <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Employee" /></label>
        <label>Status <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All</option><option value="ready">Ready</option><option value="needs_review">Needs review</option><option value="approved">Approved</option><option value="not_started">Not started</option>
        </select></label>
      </div>
      <PayrollOverviewView page={{ ...query.data, items: filtered }} payDate={payDate} />
    </div>
  );
}

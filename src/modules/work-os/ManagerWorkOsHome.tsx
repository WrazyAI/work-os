"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Eye, FileCheck2, RefreshCw, Users, X } from "lucide-react";
import { formatWorkOsDate } from "./date-format";

type Row = Record<string, any>;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export default function ManagerWorkOsHome() {
  const client = useQueryClient();
  const [selected, setSelected] = useState<Row | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [notes, setNotes] = useState("");
  const [rawImage, setRawImage] = useState("");
  const reports = useQuery<{ reports: Row[] }>({ queryKey: ["work-os", "manager-reports"], queryFn: () => request("/api/work-os/reports") });
  const people = useQuery<{ people: Row[] }>({ queryKey: ["work-os", "manager-people"], queryFn: () => request("/api/work-os/people") });
  const evidence = useQuery<{ evidence: Row[] }>({
    queryKey: ["work-os", "manager-evidence", selected?.person_id, selected?.report_date],
    queryFn: () => request(`/api/work-os/evidence?personId=${selected?.person_id}&date=${selected?.report_date}`),
    enabled: !!selected?.person_id && !!selected?.report_date,
  });
  const openScreenshot = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => request<{ url: string }>(`/api/work-os/evidence/screenshots/${id}/access`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
    }),
    onSuccess: (result) => setRawImage(result.url),
  });
  const review = useMutation({
    mutationFn: (status: "approved" | "rejected") => request(`/api/work-os/reports/${selected?.id}/review`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, markdown, manager_notes: notes }),
    }),
    onSuccess: async () => { setSelected(null); setNotes(""); await client.invalidateQueries({ queryKey: ["work-os", "manager-reports"] }); },
  });
  const pending = (reports.data?.reports ?? []).filter((report) => report.status === "pending_review");
  const error = reports.error || people.error || evidence.error || review.error || openScreenshot.error;

  return (
    <div className="min-h-[calc(100vh-8rem)] border border-[var(--border)] bg-[var(--bg-primary)]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--bg-card)] px-5 py-4">
        <div><p className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[var(--accent)]"><Users size={14} /> Team Work OS</p><h1 className="mt-1 text-xl font-semibold">Manager review</h1></div>
        <button title="Refresh" aria-label="Refresh" onClick={() => void client.invalidateQueries({ queryKey: ["work-os"] })} className="grid size-9 place-items-center border border-[var(--border)]"><RefreshCw size={15} /></button>
      </header>
      {error && <div className="m-5 flex items-center gap-2 border border-[var(--status-err)] p-3 text-[12px] text-[var(--status-err)]"><AlertTriangle size={15} />{(error as Error).message}</div>}
      <main className="grid gap-5 p-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><h2 className="text-sm font-semibold">Pending reports</h2><span className="text-[11px] text-[var(--text-tertiary)]">{pending.length}</span></div>
          <div>{pending.map((report) => <button key={report.id} onClick={() => { setSelected(report); setMarkdown(report.submitted_markdown || report.markdown); setNotes(report.manager_notes || ""); }} className="block h-auto w-full border-0 border-b border-[var(--border)] px-4 py-3 text-left"><strong className="block text-[13px]">{report.person?.display_name || "Unmapped person"}</strong><span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">{formatWorkOsDate(report.report_date)}</span></button>)}{!pending.length && <p className="p-5 text-center text-[12px] text-[var(--text-tertiary)]">No reports await review.</p>}</div>
        </section>
        <section className="border border-[var(--border)] bg-[var(--bg-card)] p-4">
          {selected ? <>
            <div className="mb-3 flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><FileCheck2 size={16} />{selected.person?.display_name}</h2><p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Employee snapshot retained · {formatWorkOsDate(selected.report_date)}</p></div><button title="Close" aria-label="Close" className="grid size-8 place-items-center border border-[var(--border)]" onClick={() => setSelected(null)}><X size={14} /></button></div>
            <textarea value={markdown} onChange={(event) => setMarkdown(event.target.value)} rows={20} className="w-full resize-y border border-[var(--border)] bg-transparent p-3 font-mono text-[12px] leading-5 outline-none" />
            <div className="mt-4 border-t border-[var(--border)] pt-3"><h3 className="mb-2 text-[12px] font-semibold">Sourced evidence</h3><div className="divide-y divide-[var(--border)]">{(evidence.data?.evidence ?? []).map((item) => { const screenshot = item.event?.screenshot; const reviewable = item.event?.correction_status === "disputed" || item.event?.metadata?.needsReview === true; return <div key={item.id} className="py-2 text-[11px]"><div className="flex items-start justify-between gap-3"><div><strong className="text-[12px]">{item.title}</strong><p className="mt-1 leading-5 text-[var(--text-secondary)]">{item.summary}</p><span className="mt-1 block uppercase text-[9px] text-[var(--text-tertiary)]">{item.event?.evidence_class || item.source}{item.event?.correction_status !== "original" ? ` · ${item.event?.correction_status}` : ""}</span></div>{screenshot?.storage_path && !screenshot.deleted_at && reviewable ? <button title="Open restricted screenshot" aria-label="Open restricted screenshot" className="grid size-8 shrink-0 place-items-center border border-[var(--border)]" onClick={() => { const reason = window.prompt("Reason for restricted screenshot access"); if (reason?.trim()) openScreenshot.mutate({ id: screenshot.id, reason: reason.trim() }); }}><Eye size={14} /></button> : null}</div></div>; })}{!evidence.data?.evidence?.length ? <p className="py-3 text-[11px] text-[var(--text-tertiary)]">No evidence is linked to this report date.</p> : null}</div></div>
            <label className="mt-3 grid gap-1 text-[11px] font-semibold uppercase text-[var(--text-tertiary)]">Manager notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className="resize-y border border-[var(--border)] bg-transparent p-3 text-[12px] font-normal normal-case text-[var(--text-primary)] outline-none" /></label>
            <div className="mt-3 flex justify-end gap-2"><button disabled={review.isPending} onClick={() => review.mutate("rejected")} className="inline-flex items-center gap-2 border border-[var(--status-err)] px-3 py-2 text-[12px] text-[var(--status-err)]"><X size={14} /> Reject</button><button disabled={review.isPending} onClick={() => review.mutate("approved")} className="inline-flex items-center gap-2 bg-[var(--accent)] px-3 py-2 text-[12px] font-semibold text-[var(--text-inverse)]"><Check size={14} /> Approve</button></div>
          </> : <div className="grid min-h-80 place-items-center text-[12px] text-[var(--text-tertiary)]">Select a pending report.</div>}
        </section>
      </main>
      {rawImage ? <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" role="dialog" aria-modal="true"><div className="max-h-full max-w-5xl border border-[var(--border)] bg-[var(--bg-card)] p-3"><div className="mb-2 flex justify-end"><button title="Close screenshot" aria-label="Close screenshot" onClick={() => setRawImage("")} className="grid size-8 place-items-center border border-[var(--border)]"><X size={14} /></button></div><img src={rawImage} alt="Restricted Worktivity screenshot" className="max-h-[80vh] max-w-full object-contain" /></div></div> : null}
    </div>
  );
}

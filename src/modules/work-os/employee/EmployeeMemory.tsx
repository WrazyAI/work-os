"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, Trash2, X } from "lucide-react";
import { calendarDateLabel, fetchJson, formatDateTimeShort, requestId, type WorkMemoryResponse } from "./model";
import { EmptyState, Notice, Panel, PrimaryButton, SecondaryButton, Skeleton, inputClass, inputStyle } from "./ui";

type MemoryTab = "review" | "remembered";

/**
 * What Otto remembers (companion parity, design.md §8.5).
 *
 * One flat band on the settings surface owns the counts and the View action;
 * the modal owns the facts. Keep / Not true / Forget keep their exact
 * companion behavior — nothing is remembered without a keep.
 */
export default function EmployeeMemory({ enabled = true }: { enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const memory = useQuery<WorkMemoryResponse>({
    queryKey: ["work-os", "memory"],
    queryFn: () => fetchJson("/api/work-os/me/memory"),
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) return null;

  const facts = memory.data?.facts ?? [];
  const proposed = facts.filter((fact) => fact.review_status === "candidate");
  const remembered = facts.filter((fact) => fact.review_status === "confirmed");

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--bg-primary)", color: "var(--accent-deep)" }}>
            <Brain size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">What Otto remembers</h2>
            <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-secondary)]">Facts Otto proposed from your updates, kept only when you say they are true.</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[12px] text-[var(--text-secondary)]">
            Remembered <strong className="tabular-nums text-[var(--text-primary)]">{remembered.length}</strong>
          </span>
          <span className="text-[12px]" style={{ color: proposed.length ? "var(--status-warn)" : "var(--text-secondary)" }}>
            Need review <strong className="tabular-nums">{proposed.length}</strong>
          </span>
          <SecondaryButton onClick={() => setOpen(true)}>View</SecondaryButton>
        </div>
      </div>
      {open ? (
        <MemoryModal
          facts={facts}
          recent={memory.data?.recent ?? []}
          loading={memory.isLoading && !memory.data}
          error={memory.error ? (memory.error as Error).message : null}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </Panel>
  );
}

function MemoryModal({
  facts,
  recent,
  loading,
  error,
  onClose,
}: {
  facts: WorkMemoryResponse["facts"];
  recent: WorkMemoryResponse["recent"];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MemoryTab>("review");
  const [showAllRecent, setShowAllRecent] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["work-os", "memory"] });
  const reviewFact = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "confirmed" | "rejected" }) => fetchJson(`/api/work-os/me/memory/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify({ status }),
    }),
    onSuccess: refresh,
  });
  const forgetItem = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/work-os/me/memory/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, []);

  const proposed = facts.filter((fact) => fact.review_status === "candidate");
  const remembered = facts.filter((fact) => fact.review_status === "confirmed");
  const tabs: Array<{ id: MemoryTab; label: string; count: number }> = [
    { id: "review", label: "Needs review", count: proposed.length },
    { id: "remembered", label: "Remembered", count: remembered.length },
  ];
  const visibleRecent = showAllRecent ? recent : recent.slice(0, 8);
  const mutationError = reviewFact.error || forgetItem.error;

  const activateTab = (id: MemoryTab) => {
    setTab(id);
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[role="tab"][data-tab="${id}"]`)?.focus());
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="presentation">
      <button type="button" aria-label="Close memory management" onClick={onClose} className="absolute inset-0 cursor-default bg-black/40" tabIndex={-1} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="What Otto remembers"
        className="relative flex max-h-[88vh] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl border shadow-2xl"
        style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
      >
        <header className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">What Otto remembers</h2>
            <p className="mt-0.5 text-[12px] leading-5 text-[var(--text-secondary)]">Facts Otto proposed from your updates, kept only when you say they are true.</p>
          </div>
          <SecondaryButton onClick={onClose} aria-label="Close" className="!p-2"><X size={15} /></SecondaryButton>
        </header>

        <div role="tablist" aria-label="Memory views" className="flex gap-1 border-b px-5 pt-3" style={{ borderColor: "var(--border)" }}>
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              data-tab={item.id}
              aria-selected={tab === item.id}
              aria-controls={`memory-panel-${item.id}`}
              tabIndex={tab === item.id ? 0 : -1}
              onClick={() => setTab(item.id)}
              onKeyDown={(event) => {
                if (["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) {
                  event.preventDefault();
                  const index = tabs.findIndex((entry) => entry.id === tab);
                  const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
                  activateTab(tabs[next].id);
                }
              }}
              className="rounded-t-[10px] px-3 py-2 text-[12px] font-semibold"
              style={tab === item.id ? { color: "var(--accent-deep)", background: "color-mix(in srgb, var(--accent-deep) 10%, var(--bg-card))" } : { color: "var(--text-secondary)" }}
            >
              {item.label} <span className="tabular-nums opacity-70">({item.count})</span>
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error ? <Notice tone="err" className="mb-3">{error}</Notice> : null}
          {mutationError ? <Notice tone="err" className="mb-3">{(mutationError as Error).message}</Notice> : null}
          {loading ? (
            <div className="grid gap-2" aria-busy="true"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/4" /></div>
          ) : tab === "review" ? (
            <div id="memory-panel-review" role="tabpanel">
              {proposed.length ? (
                <ul className="grid gap-3">
                  {proposed.map((fact) => (
                    <li key={fact.id} className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
                      <p className="text-[13px] leading-5 text-[var(--text-primary)]">{fact.content}</p>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">From your updates{fact.local_date ? ` · ${calendarDateLabel(fact.local_date)}` : fact.occurred_at ? ` · ${formatDateTimeShort(fact.occurred_at)}` : ""}</span>
                        <span className="flex gap-2">
                          <SecondaryButton className="!px-2.5 !py-1.5 !text-[11px]" disabled={reviewFact.isPending} onClick={() => reviewFact.mutate({ id: fact.id, status: "rejected" })}>Not true</SecondaryButton>
                          <PrimaryButton className="!px-2.5 !py-1.5 !text-[11px]" disabled={reviewFact.isPending} onClick={() => reviewFact.mutate({ id: fact.id, status: "confirmed" })}><Check size={12} /> Keep</PrimaryButton>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<Brain size={20} />} title="Nothing needs review" message="When Otto proposes a fact from your updates, it waits here for you." />
              )}
            </div>
          ) : (
            <div id="memory-panel-remembered" role="tabpanel">
              {remembered.length ? (
                <ul>
                  {remembered.map((fact) => (
                    <li key={fact.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5" style={{ borderColor: "var(--border)" }}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] leading-5 text-[var(--text-primary)]"><Check size={11} className="mr-1 inline" style={{ color: "var(--status-ok)" }} />{fact.content}</p>
                        <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{fact.local_date ? `Kept ${calendarDateLabel(fact.local_date)}` : "Kept"}</span>
                      </div>
                      <QuietDelete disabled={forgetItem.isPending} onClick={() => forgetItem.mutate(fact.id)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-[12px] text-[var(--text-tertiary)]">Nothing kept yet.</p>
              )}

              <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">Recent activity</p>
                {visibleRecent.length ? (
                  <ul className="mt-2">
                    {visibleRecent.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5" style={{ borderColor: "var(--border)" }}>
                        <div className="min-w-0 flex-1">
                          <span className="block text-[10px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]">{item.kind}</span>
                          <p className="text-[12px] leading-5 text-[var(--text-primary)]">{item.summary || item.content}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {item.local_date ? <span className="text-[11px] text-[var(--text-tertiary)]">{calendarDateLabel(item.local_date)}</span> : null}
                          <QuietDelete disabled={forgetItem.isPending} onClick={() => forgetItem.mutate(item.id)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[12px] text-[var(--text-tertiary)]">No recent memory activity.</p>
                )}
                {!showAllRecent && recent.length > 8 ? (
                  <button type="button" className="mt-2 text-[12px] font-semibold" style={{ color: "var(--accent-deep)" }} onClick={() => setShowAllRecent(true)}>
                    Show all {recent.length}
                  </button>
                ) : null}
                <p className="mt-3 text-[11px] leading-5 text-[var(--text-tertiary)]">Memory grounds Otto&apos;s answers in your own record. It is never used as performance evidence.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QuietDelete({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[11px] font-semibold disabled:opacity-50"
      style={{ color: "var(--text-tertiary)" }}
    >
      <Trash2 size={12} /> Forget
    </button>
  );
}

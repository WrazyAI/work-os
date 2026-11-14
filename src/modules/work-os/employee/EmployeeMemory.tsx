"use client";

import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { reviewedMemoryPages, reviewedMemorySummary } from "../memory-review-cache";
import { Brain, Check, Trash2, X } from "lucide-react";
import { calendarDateLabel, fetchJson, formatDateTimeShort, requestId, type WorkMemoryResponse } from "./model";
import { EmptyState, Notice, PrimaryButton, SecondaryButton, Skeleton } from "./ui";
import styles from "./EmployeeSettings.module.css";

type MemoryTab = "review" | "remembered";
type FactStatus = "candidate" | "confirmed";
type FactPage = { facts: WorkMemoryResponse["facts"]; total: number; nextCursor: string | null };

function useFactPages(status: FactStatus, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["work-os", "memory", "facts", status],
    enabled, staleTime: 60_000,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchJson<FactPage>(`/api/work-os/me/memory?status=${status}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { signal }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/**
 * What Otto remembers (companion parity, design.md §8.5).
 *
 * One flat band on the settings surface owns the counts and the View action;
 * the modal owns the facts. Keep / Not true / Forget keep their exact
 * companion behavior — nothing is remembered without a keep.
 */
export default function EmployeeMemory({ enabled = true }: { enabled?: boolean }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const memory = useQuery<WorkMemoryResponse>({
    queryKey: ["work-os", "memory"],
    queryFn: async () => {
      const result = await fetchJson<WorkMemoryResponse>("/api/work-os/me/memory");
      await client.invalidateQueries({ queryKey: ["work-os", "memory", "facts"], refetchType: "active" });
      return result;
    },
    enabled,
    staleTime: 60_000,
  });
  const confirmed = useFactPages("confirmed", enabled && open && !!memory.data?.factTotals);
  const candidates = useFactPages("candidate", enabled && open && !!memory.data?.factTotals);

  if (!enabled) return null;

  const facts = memory.data?.facts ?? [];
  const proposed = facts.filter((fact) => fact.review_status === "candidate");
  const remembered = facts.filter((fact) => fact.review_status === "confirmed");
  const totals = memory.data?.factTotals ?? { confirmed: remembered.length, candidate: proposed.length };
  const modalFacts = [...new Map([
    ...(confirmed.data?.pages.flatMap(page => page.facts) ?? remembered),
    ...(candidates.data?.pages.flatMap(page => page.facts) ?? proposed),
  ].map(fact => [fact.id, fact])).values()];

  return (
    <>
      <section className={styles.group} aria-labelledby="settings-memory-title">
        <div className={styles.groupLabel}>
          <h2 id="settings-memory-title">Memory</h2>
          <p>Facts Otto proposes from your updates, kept only when you say they are true.</p>
        </div>
        <div className={styles.groupContent}>
          <div className={styles.memoryBand}>
            <div className={styles.memoryLead}>
              <span className={styles.memoryMark} aria-hidden="true"><Brain size={16} /></span>
              <div>
                <p className={styles.memoryTitle}>What Otto remembers</p>
                <p className={styles.memoryCopy}>Facts Otto proposed from your updates, kept only when you say they are true.</p>
              </div>
            </div>
            <div className={styles.memorySide}>
              <span className={styles.memoryCount}>Remembered <strong>{totals.confirmed}</strong></span>
              <span className={`${styles.memoryCount} ${totals.candidate ? styles.memoryNeed : styles.memoryNeedQuiet}`}>
                Need review <strong>{totals.candidate}</strong>
              </span>
              <button type="button" className={styles.secondaryButton} onClick={() => setOpen(true)}>View</button>
            </div>
          </div>
        </div>
      </section>
      {open ? (
        <MemoryModal
          facts={modalFacts}
          totals={totals}
          confirmedPages={confirmed}
          candidatePages={candidates}
          recent={memory.data?.recent ?? []}
          loading={memory.isLoading && !memory.data}
          error={memory.error ? (memory.error as Error).message : null}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function MemoryModal({
  facts,
  recent,
  loading,
  error,
  onClose,
  totals,
  confirmedPages,
  candidatePages,
}: {
  facts: WorkMemoryResponse["facts"];
  recent: WorkMemoryResponse["recent"];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  totals: { confirmed: number; candidate: number };
  confirmedPages: ReturnType<typeof useFactPages>;
  candidatePages: ReturnType<typeof useFactPages>;
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
    onSuccess: (_receipt, { id, status }) => {
      const fact = facts.find(row => row.id === id);
      if (fact) {
        queryClient.setQueryData<WorkMemoryResponse>(["work-os", "memory"], current => reviewedMemorySummary(current, fact, status));
        for (const lane of ["confirmed", "candidate"] as const) {
          queryClient.setQueryData<InfiniteData<FactPage>>(["work-os", "memory", "facts", lane], current => reviewedMemoryPages(current, lane, fact, status));
        }
      }
      refresh();
    },
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
    { id: "review", label: "Needs review", count: totals.candidate },
    { id: "remembered", label: "Remembered", count: totals.confirmed },
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
                        <span className="text-[10.5px] text-[var(--text-tertiary)]">From your updates{fact.local_date ? ` · ${calendarDateLabel(fact.local_date)}` : fact.occurred_at ? ` · ${formatDateTimeShort(fact.occurred_at)}` : ""}</span>
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
              <FactPageEdge query={candidatePages} loaded={proposed.length} total={totals.candidate} label="Load more proposals" busy={reviewFact.isPending || forgetItem.isPending} />
            </div>
          ) : (
            <div id="memory-panel-remembered" role="tabpanel">
              {remembered.length ? (
                <ul>
                  {remembered.map((fact) => (
                    <li key={fact.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5" style={{ borderColor: "var(--border)" }}>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] leading-5 text-[var(--text-primary)]"><Check size={11} className="mr-1 inline" style={{ color: "var(--status-ok)" }} />{fact.content}</p>
                        <span className="text-[10.5px] text-[var(--text-tertiary)]">{fact.local_date ? `Kept ${calendarDateLabel(fact.local_date)}` : "Kept"}</span>
                      </div>
                      <QuietDelete disabled={forgetItem.isPending} onClick={() => forgetItem.mutate(fact.id)} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-3 text-[12px] text-[var(--text-tertiary)]">Nothing kept yet.</p>
              )}

              <FactPageEdge query={confirmedPages} loaded={remembered.length} total={totals.confirmed} label="Load more remembered facts" busy={reviewFact.isPending || forgetItem.isPending} />

              <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                <p className="text-[11.5px] font-semibold text-[var(--text-secondary)]">Recent activity</p>
                {visibleRecent.length ? (
                  <ul className="mt-2">
                    {visibleRecent.map((item) => (
                      <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2.5" style={{ borderColor: "var(--border)" }}>
                        <div className="min-w-0 flex-1">
                          <span className="block text-[10.5px] text-[var(--text-tertiary)]">{item.kind}</span>
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

function FactPageEdge({ query, loaded, total, label, busy }: {
  query: ReturnType<typeof useFactPages>; loaded: number; total: number; label: string; busy: boolean;
}) {
  return <div className="mt-3 grid gap-2">
    <p role="status" className="text-[12px] text-[var(--text-secondary)]">Showing {loaded} of {total}</p>
    {query.error && <Notice tone="err">Memories could not be loaded. Please retry.</Notice>}
    {(query.hasNextPage || query.error) && <SecondaryButton disabled={busy || query.isFetching} onClick={() => {
      if (!query.isFetching) void (query.hasNextPage && !query.isRefetchError ? query.fetchNextPage() : query.refetch());
    }}>{query.isFetching ? "Loading memories…" : label}</SecondaryButton>}
  </div>;
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

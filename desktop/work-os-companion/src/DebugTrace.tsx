import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { diagnosticsPage, type DiagnosticsPage, type DiagnosticsPageInput, type PagedDiagnosticEvent } from "./debugDiagnostics";
import type { DiagnosticLevel, DiagnosticSource } from "./diagnostics";
import type { DebugTraceFixture } from "./debugTraceFixture";
import { listen } from "./tauriEvents";
import {
  EMPTY_TRACE_WINDOW,
  TRACE_PAGE,
  TRACE_SLOW_MS,
  appendOlder,
  formatDuration,
  messageIsRedundant,
  prependNewer,
  replaceWindow,
  routeOf,
  type TraceWindow,
} from "./traceView";

export type TraceFilters = { query: string; level: DiagnosticLevel | "all"; source: DiagnosticSource | "all" };

type Props = {
  filters: TraceFilters;
  onFiltersChange: (next: TraceFilters) => void;
  fixture: DebugTraceFixture | null;
  clearFloor: number | null;
  onClear: (seq: number) => void;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
};

type TraceOps = {
  invalidate: () => void;
  loadFresh: () => void;
  loadOlder: () => void;
  loadNewer: () => void;
  requestRefresh: () => void;
};

const FILTER_DEBOUNCE_MS = 160;
const TOP_THRESHOLD_PX = 24;
const LOAD_FAILED = "The trace could not be read. Try again.";

function toPageInput(filters: TraceFilters, clearFloor: number | null): DiagnosticsPageInput {
  return {
    query: filters.query.trim() || undefined,
    level: filters.level === "all" ? undefined : filters.level,
    source: filters.source === "all" ? undefined : filters.source,
    since: clearFloor ?? undefined,
  };
}

function eventOf(row: PagedDiagnosticEvent): Omit<PagedDiagnosticEvent, "seq"> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "seq")) as Omit<PagedDiagnosticEvent, "seq">;
}

export function DebugTrace({ filters, onFiltersChange, fixture, clearFloor, onClear, paused, onPausedChange }: Props) {
  const [view, setView] = useState<TraceWindow>(EMPTY_TRACE_WINDOW);
  const [ready, setReady] = useState(false);
  const [total, setTotal] = useState(0);
  const [pendingNew, setPendingNew] = useState(0);
  const [atTop, setAtTop] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [flash, setFlash] = useState<"loaded" | "event" | null>(null);

  const windowRef = useRef<TraceWindow>(EMPTY_TRACE_WINDOW);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const clearFloorRef = useRef(clearFloor);
  clearFloorRef.current = clearFloor;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const atTopRef = useRef(atTop);
  const genRef = useRef(0);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const headRef = useRef(0);
  const seenHeadRef = useRef(0);
  const wasPausedRef = useRef(paused);
  const retryRef = useRef<(() => void) | null>(null);
  const refreshAgainRef = useRef(false);
  const scrollAnchorRef = useRef<{ seq: number; top: number } | null>(null);
  const olderQueued = useRef(false);
  const newerQueued = useRef(false);
  const refreshQueued = useRef(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const ops = useRef<TraceOps | null>(null);

  function pageSource(input: DiagnosticsPageInput): Promise<DiagnosticsPage> {
    return fixture ? fixture.page(input) : diagnosticsPage(input);
  }

  function commit(next: TraceWindow) {
    windowRef.current = next;
    setView(next);
  }

  function enqueue(task: () => Promise<void>, retry: () => void = () => ops.current?.loadFresh()) {
    queueRef.current = queueRef.current.then(task).catch(() => {
      retryRef.current = retry;
      setNotice(LOAD_FAILED);
    });
  }

  async function runFresh(gen: number) {
    const page = await pageSource({ ...toPageInput(filtersRef.current, clearFloorRef.current), limit: TRACE_PAGE });
    if (gen !== genRef.current) return;
    commit(replaceWindow(page));
    setTotal(page.matchingTotal);
    setPendingNew(0);
    setNotice(null);
    retryRef.current = null;
    setReady(true);
    headRef.current = Math.max(headRef.current, page.headSeq);
    seenHeadRef.current = page.headSeq;
    atTopRef.current = true;
    setAtTop(true);
    listRef.current?.scrollTo({ top: 0 });
  }

  async function runRefresh(gen: number) {
    if (pausedRef.current) return;
    const first = windowRef.current.rows[0];
    if (!first) return runFresh(gen);
    const anchor = atTopRef.current ? first.seq : seenHeadRef.current;
    const input = toPageInput(filtersRef.current, clearFloorRef.current);
    // Scrolled away from the newest rows: count what arrived instead of moving the view.
    if (!atTopRef.current) {
      const counted = await pageSource({ ...input, after: anchor, limit: 0 });
      if (gen !== genRef.current) return;
      setPendingNew(counted.matchingAfter ?? 0);
      setTotal(counted.matchingTotal);
      setNotice(null);
      retryRef.current = null;
      return;
    }
    const page = await pageSource({ ...input, after: anchor, limit: TRACE_PAGE });
    if (gen !== genRef.current) return;
    // A burst larger than one page would leave a gap; the newest page is always contiguous.
    if (page.hasNewer) return runFresh(gen);
    commit(prependNewer(windowRef.current, page));
    setTotal(page.matchingTotal);
    setPendingNew(0);
    seenHeadRef.current = headRef.current;
    setNotice(null);
    retryRef.current = null;
  }

  ops.current = {
    invalidate: () => {
      genRef.current += 1;
      refreshQueued.current = false;
      refreshAgainRef.current = false;
      olderQueued.current = false;
      newerQueued.current = false;
    },
    loadFresh: () => {
      const gen = ++genRef.current;
      enqueue(() => runFresh(gen), () => ops.current?.loadFresh());
    },
    requestRefresh: () => {
      if (refreshQueued.current) {
        refreshAgainRef.current = true;
        return;
      }
      refreshQueued.current = true;
      const gen = genRef.current;
      enqueue(async () => {
        if (gen !== genRef.current) return;
        try {
          await runRefresh(gen);
        } finally {
          if (gen === genRef.current) {
            refreshQueued.current = false;
            if (refreshAgainRef.current) {
              refreshAgainRef.current = false;
              ops.current?.requestRefresh();
            }
          }
        }
      }, () => ops.current?.requestRefresh());
    },
    loadOlder: () => {
      if (olderQueued.current) return;
      olderQueued.current = true;
      const gen = genRef.current;
      enqueue(async () => {
        if (gen !== genRef.current) return;
        olderQueued.current = false;
        const current = windowRef.current;
        const last = current.rows[current.rows.length - 1];
        if (!last || !current.hasOlder) return;
        const page = await pageSource({ ...toPageInput(filtersRef.current, clearFloorRef.current), before: last.seq, limit: TRACE_PAGE });
        if (gen !== genRef.current) return;
        const anchorElement = listRef.current?.querySelector<HTMLElement>(`[data-seq="${last.seq}"]`);
        if (anchorElement) {
          scrollAnchorRef.current = { seq: last.seq, top: anchorElement.getBoundingClientRect().top };
        }
        commit(appendOlder(windowRef.current, page));
        retryRef.current = null;
        setNotice(null);
      }, () => ops.current?.loadOlder());
    },
    loadNewer: () => {
      if (newerQueued.current) return;
      newerQueued.current = true;
      const gen = genRef.current;
      enqueue(async () => {
        if (gen !== genRef.current) return;
        newerQueued.current = false;
        const current = windowRef.current;
        const first = current.rows[0];
        if (!first || !current.hasNewer) return;
        const page = await pageSource({ ...toPageInput(filtersRef.current, clearFloorRef.current), after: first.seq, limit: TRACE_PAGE });
        if (gen !== genRef.current) return;
        commit(prependNewer(windowRef.current, page));
        retryRef.current = null;
        setNotice(null);
      }, () => ops.current?.loadNewer());
    },
  };

  // Filter changes drop in-flight rows at once and reload after the user pauses typing.
  useEffect(() => {
    ops.current?.invalidate();
    commit(EMPTY_TRACE_WINDOW);
    setReady(false);
    setTotal(0);
    setExpanded(null);
    setNotice(null);
    retryRef.current = null;
    const timer = window.setTimeout(() => ops.current?.loadFresh(), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filters.query, filters.level, filters.source]);

  useEffect(() => {
    const wasPaused = wasPausedRef.current;
    wasPausedRef.current = paused;
    if (wasPaused && !paused) ops.current?.requestRefresh();
  }, [paused]);

  useEffect(() => {
    let disposed = false;
    const cleaners: Array<() => void> = [];
    const onChanged = (seq: number) => {
      headRef.current = Math.max(headRef.current, seq);
      if (pausedRef.current) return;
      ops.current?.requestRefresh();
    };
    if (fixture) {
      cleaners.push(fixture.start(onChanged));
    } else {
      void listen<{ seq: number }>("work-os://diagnostics-changed", (event) => onChanged(event.payload?.seq ?? 0))
        .then((off) => { if (disposed) off(); else cleaners.push(off); })
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      cleaners.forEach((off) => off());
    };
  }, [fixture]);

  // When loading older rows over the cap, the newest rows are removed above the
  // viewport. Keep the old oldest row at the same screen position to avoid a jump.
  useLayoutEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    scrollAnchorRef.current = null;
    const root = listRef.current;
    const element = root?.querySelector<HTMLElement>(`[data-seq="${anchor.seq}"]`);
    if (!root || !element) return;
    root.scrollTop += element.getBoundingClientRect().top - anchor.top;
  }, [view.rows]);

  // Load on demand as the sentinels near the viewport. Re-observing after each change
  // re-checks a sentinel that stayed visible, so short lists fill without scrolling.
  useEffect(() => {
    const root = listRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        if (entry.target === bottomSentinelRef.current) ops.current?.loadOlder();
        if (entry.target === topSentinelRef.current) ops.current?.loadNewer();
      }
    }, { root, rootMargin: "200px 0px" });
    if (topSentinelRef.current) observer.observe(topSentinelRef.current);
    if (bottomSentinelRef.current) observer.observe(bottomSentinelRef.current);
    return () => observer.disconnect();
  }, [view.rows.length, view.hasOlder, view.hasNewer, ready]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 2200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  function onScroll() {
    const top = (listRef.current?.scrollTop ?? 0) < TOP_THRESHOLD_PX;
    if (top === atTopRef.current) return;
    atTopRef.current = top;
    setAtTop(top);
    if (top) {
      setPendingNew(0);
      ops.current?.requestRefresh();
    }
  }

  function jumpToNewest() {
    listRef.current?.scrollTo({ top: 0 });
    ops.current?.loadFresh();
  }

  function clearView() {
    ops.current?.invalidate();
    commit(EMPTY_TRACE_WINDOW);
    setPendingNew(0);
    setExpanded(null);
    setNotice(null);
    retryRef.current = null;
    // Use the host's unfiltered cursor so events emitted after this click remain visible.
    clearFloorRef.current = headRef.current;
    onClear(headRef.current);
    seenHeadRef.current = headRef.current;
  }

  function copyLoaded() {
    const lines = windowRef.current.rows.map((row) => JSON.stringify(eventOf(row)));
    void navigator.clipboard.writeText(lines.join("\n")).then(() => setFlash("loaded")).catch(() => undefined);
  }

  function copyEvent(row: PagedDiagnosticEvent) {
    void navigator.clipboard.writeText(JSON.stringify(eventOf(row), null, 2)).then(() => setFlash("event")).catch(() => undefined);
  }

  function moveFocus(event: KeyboardEvent<HTMLOListElement>) {
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(".trace-row"));
    const index = rows.indexOf(event.target as HTMLButtonElement);
    if (index === -1) return;
    const next = event.key === "ArrowDown" ? index + 1
      : event.key === "ArrowUp" ? index - 1
      : event.key === "Home" ? 0
      : event.key === "End" ? rows.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    const target = rows[Math.min(Math.max(next, 0), rows.length - 1)];
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }

  const hasFilters = filters.query.trim() !== "" || filters.level !== "all" || filters.source !== "all";
  const cleared = clearFloor !== null && view.rows.length === 0;
  const emptyCopy = !ready ? (notice ?? "Loading events…")
    : cleared ? "View cleared. New events appear here as they arrive."
    : hasFilters ? "No events match these filters. Widen the level or source filter, or clear the search."
    : "No diagnostics recorded in this session yet.";

  return <section className="trace-panel" aria-label="Live trace">
    <div className="trace-toolbar">
      <input value={filters.query} onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })} placeholder="Search category, path, message, correlation" aria-label="Search events" />
      <select value={filters.level} onChange={(event) => onFiltersChange({ ...filters, level: event.target.value as DiagnosticLevel | "all" })} aria-label="Filter by level"><option value="all">All levels</option><option value="trace">trace</option><option value="debug">debug</option><option value="info">info</option><option value="warn">warn</option><option value="error">error</option></select>
      <select value={filters.source} onChange={(event) => onFiltersChange({ ...filters, source: event.target.value as DiagnosticSource | "all" })} aria-label="Filter by source"><option value="all">All sources</option><option value="frontend">frontend</option><option value="rust">rust</option><option value="ipc">ipc</option><option value="sync">sync</option><option value="storage">storage</option></select>
      <button type="button" aria-pressed={paused} onClick={() => onPausedChange(!paused)}>{paused ? "Resume" : "Pause"}</button>
      <button type="button" title="Clearing the view does not delete disk logs." onClick={clearView}>Clear view</button>
    </div>
    <div className="trace-options">
      <span className="trace-count">Showing {view.rows.length} of {total} · newest first</span>
      <button type="button" disabled={view.rows.length === 0} onClick={copyLoaded}>{flash === "loaded" ? "Copied" : `Copy loaded (${view.rows.length})`}</button>
    </div>
    {notice && <p className="debug-warning trace-notice" role="alert"><span>{notice}</span><button type="button" onClick={() => { const retry = retryRef.current; setNotice(null); retry?.(); }}>Retry</button></p>}
    <div className="trace-stage">
      <span className="trace-jump-live" aria-live="polite">{pendingNew > 0 && !atTop ? `${pendingNew} new events` : ""}</span>
      {pendingNew > 0 && !atTop && <button type="button" className="trace-jump" onClick={jumpToNewest}>{pendingNew} new · Jump to newest</button>}
      <div className="trace-scroll" ref={listRef} onScroll={onScroll}>
        <div ref={topSentinelRef} className="trace-sentinel" aria-hidden="true" />
        {view.hasNewer && <button type="button" className="trace-load" onClick={() => ops.current?.loadNewer()}>Load {TRACE_PAGE} newer</button>}
        {view.rows.length > 0 ? <ol className="trace-list" aria-label="Diagnostic events, newest first" onKeyDown={moveFocus}>
          {view.rows.map((row) => <TraceRow key={row.seq} row={row} expanded={expanded === row.seq} copied={flash === "event"} onToggle={() => setExpanded(expanded === row.seq ? null : row.seq)} onCopy={() => copyEvent(row)} />)}
        </ol> : !notice && <p className="debug-empty">{emptyCopy}</p>}
        <div ref={bottomSentinelRef} className="trace-sentinel" aria-hidden="true" />
        {view.hasOlder && <button type="button" className="trace-load" onClick={() => ops.current?.loadOlder()}>Load {TRACE_PAGE} older</button>}
      </div>
    </div>
  </section>;
}

function TraceRow({ row, expanded, copied, onToggle, onCopy }: { row: PagedDiagnosticEvent; expanded: boolean; copied: boolean; onToggle: () => void; onCopy: () => void }) {
  const route = routeOf(row);
  const timeValid = !Number.isNaN(Date.parse(row.timestamp));
  const slow = row.durationMs !== undefined && row.durationMs >= TRACE_SLOW_MS;
  return <li>
    <button type="button" className={`trace-row ${row.level}`} data-seq={row.seq} aria-expanded={expanded} onClick={onToggle}>
      <time dateTime={timeValid ? row.timestamp : undefined}>{timeValid ? row.timestamp.slice(11, 23) : "—"}</time>
      <b className="trace-level">{row.level}</b>
      <strong className="trace-category">{row.category}</strong>
      <span className="trace-route" title={route ? [route.method, route.path].filter(Boolean).join(" ") : undefined}>
        {route && <>{route.method && <em>{route.method}</em>}<code>{route.path}</code></>}
      </span>
      <span className={`trace-duration ${slow ? "slow" : ""}`}>{row.durationMs !== undefined ? formatDuration(row.durationMs) : ""}</span>
      <span className="trace-message">{messageIsRedundant(row) ? "" : row.message}</span>
    </button>
    {expanded && <pre>{JSON.stringify(eventOf(row), null, 2)}<button type="button" onClick={onCopy}>{copied ? "Copied" : "Copy event"}</button></pre>}
  </li>;
}

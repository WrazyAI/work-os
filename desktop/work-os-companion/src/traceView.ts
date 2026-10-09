import type { DiagnosticEvent } from "./diagnostics";
import type { PagedDiagnosticEvent } from "./debugDiagnostics";

/** Rows fetched per request. Matches the Rust page default. */
export const TRACE_PAGE = 50;
/** Most rows the debugger keeps mounted at once. Trimming happens at the far end. */
export const TRACE_LOADED_CAP = 100;
/** Completed spans at or above this duration are marked slow. */
export const TRACE_SLOW_MS = 1000;

export type TracePage = { events: PagedDiagnosticEvent[]; hasNewer: boolean; hasOlder: boolean };

/** A contiguous, newest-first window of history. `hasNewer`/`hasOlder` say whether
 * matching history exists beyond either edge that is not loaded yet. */
export type TraceWindow = { rows: PagedDiagnosticEvent[]; hasNewer: boolean; hasOlder: boolean };

export const EMPTY_TRACE_WINDOW: TraceWindow = { rows: [], hasNewer: false, hasOlder: false };

export function replaceWindow(page: TracePage): TraceWindow {
  return keepBottomCap({ rows: page.events, hasNewer: page.hasNewer, hasOlder: page.hasOlder });
}

/** Adds rows newer than the newest loaded row. The page is contiguous with the window. */
export function prependNewer(window: TraceWindow, page: TracePage): TraceWindow {
  const known = new Set(window.rows.map((row) => row.seq));
  const rows = [...page.events.filter((row) => !known.has(row.seq)), ...window.rows];
  return keepBottomCap({ rows, hasNewer: page.hasNewer, hasOlder: window.hasOlder });
}

/** Adds rows older than the oldest loaded row. The page is contiguous with the window. */
export function appendOlder(window: TraceWindow, page: TracePage): TraceWindow {
  const known = new Set(window.rows.map((row) => row.seq));
  const rows = [...window.rows, ...page.events.filter((row) => !known.has(row.seq))];
  return keepTopCap({ rows, hasNewer: window.hasNewer, hasOlder: page.hasOlder });
}

/** Scrolling toward older history trims the newest rows, which sit far above the viewport. */
function keepTopCap(window: TraceWindow): TraceWindow {
  if (window.rows.length <= TRACE_LOADED_CAP) return window;
  const dropped = window.rows.length - TRACE_LOADED_CAP;
  return { ...window, rows: window.rows.slice(dropped), hasNewer: true };
}

/** Newer rows arriving at the top trim the oldest rows, which sit far below the viewport. */
function keepBottomCap(window: TraceWindow): TraceWindow {
  if (window.rows.length <= TRACE_LOADED_CAP) return window;
  return { ...window, rows: window.rows.slice(0, TRACE_LOADED_CAP), hasOlder: true };
}

export function routeOf(event: DiagnosticEvent): { method: string | null; path: string } | null {
  const path = event.metadata?.path;
  if (typeof path !== "string" || path.length === 0) return null;
  const method = typeof event.metadata?.method === "string" ? event.metadata.method.toUpperCase() : null;
  return { method, path };
}

/** Span rows repeat their category ("api.request.started" with message "api.request").
 * The message is only worth a column when it says something the category does not. */
export function messageIsRedundant(event: DiagnosticEvent): boolean {
  return event.message === event.category || event.category.startsWith(`${event.message}.`);
}

export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

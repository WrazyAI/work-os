import { describe, expect, it } from "vitest";
import type { DiagnosticEvent } from "./diagnostics";
import type { PagedDiagnosticEvent } from "./debugDiagnostics";
import {
  EMPTY_TRACE_WINDOW,
  TRACE_LOADED_CAP,
  appendOlder,
  formatDuration,
  messageIsRedundant,
  prependNewer,
  replaceWindow,
  routeOf,
} from "./traceView";

function row(seq: number): PagedDiagnosticEvent {
  return {
    seq,
    id: `e-${seq}`,
    timestamp: new Date(Date.UTC(2026, 9, 9, 12, 0, 0) + seq * 1000).toISOString(),
    level: "info",
    source: "frontend",
    category: `cat.${seq}`,
    message: `message ${seq}`,
    sessionId: "s",
  };
}

/** Newest first, like a server page. */
function page(seqs: number[], flags: { hasNewer?: boolean; hasOlder?: boolean } = {}) {
  return { events: seqs.map(row), hasNewer: flags.hasNewer ?? false, hasOlder: flags.hasOlder ?? false };
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let seq = to; seq >= from; seq--) out.push(seq);
  return out;
}

describe("trace window", () => {
  it("replaces the window with a fresh newest page", () => {
    const window = replaceWindow(page(range(101, 150), { hasOlder: true }));
    expect(window.rows[0].seq).toBe(150);
    expect(window.rows).toHaveLength(50);
    expect(window.hasOlder).toBe(true);
    expect(window.hasNewer).toBe(false);
  });

  it("appends an older page contiguously and ignores duplicates", () => {
    const start = replaceWindow(page(range(101, 150), { hasOlder: true }));
    const next = appendOlder(start, page([101, 100, 99], { hasOlder: true }));
    expect(next.rows.map((entry) => entry.seq)).toEqual([...range(101, 150), 100, 99]);
    expect(next.hasOlder).toBe(true);
  });

  it("prepends newer rows above the newest loaded row", () => {
    const start = replaceWindow(page(range(101, 150)));
    const next = prependNewer(start, page([152, 151]));
    expect(next.rows[0].seq).toBe(152);
    expect(next.rows.map((entry) => entry.seq)).toEqual([152, 151, ...range(101, 150)]);
    expect(next.hasNewer).toBe(false);
  });

  it("reports more newer history when the page is not the head", () => {
    const next = prependNewer(replaceWindow(page(range(101, 150))), page([160, 159], { hasNewer: true }));
    expect(next.hasNewer).toBe(true);
  });

  it("trims the newest rows when older pages overflow the cap, and marks newer history", () => {
    let window = replaceWindow(page(range(101, 200), { hasOlder: true }));
    window = appendOlder(window, page(range(51, 100), { hasOlder: true }));
    expect(window.rows).toHaveLength(TRACE_LOADED_CAP);
    expect(window.rows[0].seq).toBe(150);
    expect(window.rows.at(-1)?.seq).toBe(51);
    expect(window.hasNewer).toBe(true);
  });

  it("trims the oldest rows when newer rows overflow the cap", () => {
    const window = replaceWindow(page(range(1, TRACE_LOADED_CAP), { hasOlder: true }));
    const next = prependNewer(window, page([TRACE_LOADED_CAP + 2, TRACE_LOADED_CAP + 1]));
    expect(next.rows).toHaveLength(TRACE_LOADED_CAP);
    expect(next.rows[0].seq).toBe(TRACE_LOADED_CAP + 2);
    expect(next.hasOlder).toBe(true);
  });

  it("keeps the empty window empty", () => {
    expect(EMPTY_TRACE_WINDOW.rows).toEqual([]);
    expect(EMPTY_TRACE_WINDOW.hasOlder).toBe(false);
  });
});

describe("trace row helpers", () => {
  const base: DiagnosticEvent = {
    id: "1",
    timestamp: "2026-10-09T12:00:00.000Z",
    level: "info",
    source: "sync",
    category: "api.request.completed",
    message: "api.request",
    sessionId: "s",
  };

  it("hides a message that only repeats the span category", () => {
    expect(messageIsRedundant(base)).toBe(true);
    expect(messageIsRedundant({ ...base, category: "app.webview.start", message: "WebView booting" })).toBe(false);
    expect(messageIsRedundant({ ...base, category: "api.request.failed", message: "Work OS request failed (503)" })).toBe(false);
  });

  it("reads the method and path from span metadata", () => {
    expect(routeOf({ ...base, metadata: { path: "/api/work-os/attendance/observe", method: "post" } })).toEqual({
      method: "POST",
      path: "/api/work-os/attendance/observe",
    });
    expect(routeOf({ ...base, metadata: { path: "" } })).toBeNull();
    expect(routeOf(base)).toBeNull();
  });

  it("formats durations in milliseconds and seconds", () => {
    expect(formatDuration(214)).toBe("214 ms");
    expect(formatDuration(1320)).toBe("1.3 s");
  });
});

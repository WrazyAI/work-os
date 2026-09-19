/** Proves the main window's UI is alive.
 *
 * The companion is a tray app, so it is rarely closed on purpose: a shutdown or
 * a hung teardown can leave a process behind that no longer has a working
 * window. Because the single-instance plugin hands a new launch over to the
 * existing process, such a leftover swallows every later launch — the splash
 * appears and the app exits with nothing on screen. The host compares this
 * heartbeat with the process it recorded, and ends a predecessor that stopped
 * beating. A window that never beats would make the app look dead, so the first
 * beat is immediate and the interval is short. */

export const INSTANCE_HEARTBEAT_MS = 5_000;

export interface HeartbeatOptions {
  intervalMs?: number;
  /** Injectable for tests; defaults to the window timer. */
  schedule?: (handler: () => void, ms: number) => number;
  cancel?: (id: number) => void;
}

/** Starts beating and returns the stop function. */
export function startInstanceHeartbeat(beat: () => void, options: HeartbeatOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? INSTANCE_HEARTBEAT_MS;
  const schedule = options.schedule ?? ((handler, ms) => window.setInterval(handler, ms));
  const cancel = options.cancel ?? ((id) => window.clearInterval(id));
  beat();
  const timer = schedule(beat, intervalMs);
  return () => cancel(timer);
}

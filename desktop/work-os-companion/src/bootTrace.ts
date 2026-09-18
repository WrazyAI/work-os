import { diagnostics } from "./diagnostics";

/** A tiny boot breadcrumb kept outside React, so a crash or a force-kill during
 * startup still leaves a trail behind.
 *
 * The companion has crashed on launch before with nothing to go on: the window
 * was gone and the diagnostics log stopped at "WebView booting". This records
 * the last boot phase and, on the next launch, reports that the previous
 * session never reached a clean exit — the difference between "it crashed" and
 * knowing exactly where. Storage is best effort: a failure here must never
 * break boot, and legacy browsers without storage simply lose the trail. */

export const BOOT_PHASE_KEY = "work-os.boot-phase";
export const CLEAN_EXIT = "clean";

export interface BootStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface BootTrace {
  /** Reads the previous run and reports it when it did not exit cleanly. */
  begin(): void;
  phase(phase: string): void;
  cleanExit(): void;
}

export function createBootTrace(
  storage: BootStorage,
  onUncleanPreviousExit: (previous: string) => void,
  onPhase?: (phase: string) => void,
): BootTrace {
  return {
    begin() {
      try {
        const previous = storage.getItem(BOOT_PHASE_KEY);
        // "clean" is written on a normal close; anything else (including a
        // half-finished phase name) means the last run died without finishing.
        if (previous && previous !== CLEAN_EXIT) onUncleanPreviousExit(previous);
        storage.setItem(BOOT_PHASE_KEY, "boot:webview");
      } catch {
        /* Storage unavailable: tracing is best effort. */
      }
    },
    phase(phase: string) {
      try {
        storage.setItem(BOOT_PHASE_KEY, phase);
        onPhase?.(phase);
      } catch {
        /* Storage unavailable: tracing is best effort. */
      }
    },
    cleanExit() {
      try {
        storage.setItem(BOOT_PHASE_KEY, CLEAN_EXIT);
      } catch {
        /* Storage unavailable: tracing is best effort. */
      }
    },
  };
}

let trace: BootTrace | null = null;

/** Installs the breadcrumb once, from the entrypoint, before React renders. */
export function installBootTrace(): BootTrace {
  if (trace) return trace;
  trace = createBootTrace(
    {
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    },
    (previous) => diagnostics.error(
      "app.boot.unclean_previous_exit",
      `The previous session ended without a clean exit (last phase: ${previous}).`,
      { lastPhase: previous },
    ),
    (phase) => diagnostics.info("app.boot.phase", phase, { phase }),
  );
  trace.begin();
  window.addEventListener("beforeunload", () => trace?.cleanExit());
  return trace;
}

export function markBootPhase(phase: string) {
  trace?.phase(phase);
}

/** Called before a step that intentionally ends the process (an update
 * install), so the next launch is not reported as a crash. */
export function markCleanExit() {
  trace?.cleanExit();
}

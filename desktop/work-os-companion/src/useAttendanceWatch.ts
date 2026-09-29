import { useEffect, useRef } from "react";
import { apiRequest } from "./api";
import { attendanceWatchInterval, type AttendanceWatchInput } from "./attendanceWatch";

interface AttendanceObserveResponse { changed?: boolean }

/** Polls the interactive attendance endpoint while a window is open.
 *
 * The cadence follows `attendanceWatchInterval`: 30s while a clock transition
 * is expected, 60s once steady. Only a real transition (the server compares
 * the tracked signature) calls `onChange`, which refreshes the day and relays
 * the event to the other window. Failures stay quiet — the next tick retries
 * and the workspace keeps its last truthful data. */
export function useAttendanceWatch({ enabled, input, onChange }: {
  enabled: boolean;
  input: AttendanceWatchInput | null;
  onChange: () => void;
}) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let timer: number | undefined;
    const tick = async () => {
      if (disposed) return;
      if (!inFlight.current && navigator.onLine) {
        inFlight.current = true;
        try {
          const result = await apiRequest<AttendanceObserveResponse>("/api/work-os/attendance/observe", { method: "POST" });
          if (!disposed && result?.changed) changeRef.current();
        } catch { /* transient; the next tick retries */ }
        finally { inFlight.current = false; }
      }
      schedule();
    };
    const schedule = () => {
      if (disposed) return;
      timer = window.setTimeout(() => void tick(), attendanceWatchInterval(inputRef.current, Date.now()));
    };
    schedule();
    return () => { disposed = true; if (timer) window.clearTimeout(timer); };
  }, [enabled]);
}

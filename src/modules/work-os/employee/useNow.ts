"use client";

import { useEffect, useState } from "react";

/** A coarse clock for time-band labels. The first render is client-side in
 * practice (day data arrives from a client fetch), so the initializer is safe
 * and the interval only ever moves forward. */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

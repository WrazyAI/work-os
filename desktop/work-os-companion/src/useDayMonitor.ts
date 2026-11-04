import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "./tauriEvents";
import { createDayMonitorClient } from "./dayMonitor";
import type { DayData, DesktopSession } from "./types";

/** Prefer the visible Employee main page, then visible avatar, then hidden
 * main. Host leases expire after 30s if a webview disappears. Voice lifetimes
 * are independent: this hook only owns read/attendance monitoring. */
export function useDayMonitor(input: {
  window: "main" | "avatar"; session: DesktopSession | null; enabled: boolean;
  activePage: boolean; onSnapshot: (day: DayData) => void;
}) {
  const [owns, setOwns] = useState(!isTauri());
  const [sharedDay, setSharedDay] = useState<DayData | null>(null);
  const latest = useRef(input); latest.current = input;
  const client = useRef<ReturnType<typeof createDayMonitorClient> | null>(null);
  useEffect(() => {
    setSharedDay(null);
    if (!input.enabled || !input.session) { setOwns(false); return; }
    if (!isTauri()) { setOwns(true); return; }
    let stopped = false;
    let current: ReturnType<typeof createDayMonitorClient> | null = null;
    setOwns(false);
    void (async () => {
      // Never send/store the bearer itself in host status events or snapshots.
      const bytes = new TextEncoder().encode(`${input.session!.organizationId}\0${input.session!.token}`);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const scope = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
      if (stopped) return;
      current = createDayMonitorClient({ scope, window: input.window,
        onOwner: (value) => { if (!stopped) setOwns(value); },
        onSnapshot: (day) => { if (!stopped) { setSharedDay(day); latest.current.onSnapshot(day); } },
        transport: {
          claim: async () => invoke<boolean>("claim_day_monitor", { scope, activePage: latest.current.activePage, visible: await getCurrentWindow().isVisible().catch(() => false) }),
          read: () => invoke<string | null>("read_day_monitor", { scope }),
          publish: (snapshot) => invoke<boolean>("publish_day_monitor", { scope, snapshot }),
          release: () => invoke("release_day_monitor", { scope }),
          listen: async (receive) => listen<string>("work-os://day-monitor-changed", ({ payload }) => receive(payload), { target: input.window }),
        },
      });
      client.current = current;
      await current.start();
    })().catch(() => {
      // A missing host/coordination channel must never strand the visible
      // pages behind a disabled monitor. Main is the safe single owner when
      // coordination is unavailable; avatar stays passive rather than duplicate.
      if (!stopped && input.window === "main") setOwns(true);
    });
    return () => { stopped = true; if (client.current === current) client.current = null; void current?.stop(); };
  }, [input.enabled, input.session?.token, input.session?.organizationId, input.window]);
  useEffect(() => { void client.current?.isOwner(); }, [input.activePage]);
  useEffect(() => {
    const refresh = () => { void client.current?.isOwner(); };
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  return { owns, sharedDay, publish: (day: DayData) => client.current?.publish(day) ?? Promise.resolve(false),
    isOwner: () => isTauri() ? client.current?.isOwner() ?? Promise.resolve(false) : Promise.resolve(input.enabled) };
}

import { useEffect, useRef, useState } from "react";
import { emit, listen } from "./tauriEvents";
import { lateReasonRequired } from "./lateStart";
import type { DayData, DebugScenario } from "./types";
import { DEFAULT_DEBUG_SCENARIO } from "./scenarios";
import { acceptMascotActivity, mascotActivityFromSignals, resolveMascotRuntime, type MascotActivityMessage, type MascotPlatformFacts, type MascotSignals } from "./mascotRuntimeModel";
import { publishMascotRuntime } from "./mascotRuntimeStore";

const LEASE_MS = 20_000;
const READY_MS = 1_800;
export function mascotFactsFromDay(day: DayData | null, connected: boolean): MascotPlatformFacts {
  return { connected, sessionState: day?.session?.state, lateReasonRequired: lateReasonRequired(day?.session), promptRequired: day?.prompt?.required,
    promptKind: day?.prompt?.kind, niftySyncError: typeof day?.niftySync?.error === "string" ? day.niftySync.error : null };
}

/** The avatar follows the main window's scenario without applying synthetic
 * records to its live conversation. Register listeners before requesting state. */
export function useMascotScenarioMirror(): DebugScenario {
  const [scenario, setScenario] = useState<DebugScenario>(DEFAULT_DEBUG_SCENARIO);
  useEffect(() => {
    let disposed = false;
    const cleaners: Array<() => void> = [];
    const register = (off: () => void) => { if (disposed) off(); else cleaners.push(off); };
    const receive = (event: { payload: DebugScenario }) => {
      if (!disposed && event.payload && typeof event.payload.enabled === "boolean") setScenario({ ...DEFAULT_DEBUG_SCENARIO, ...event.payload });
    };
    void Promise.all([
      listen<DebugScenario>("work-os://debug-current", receive).then(register),
      listen<DebugScenario>("work-os://debug-scenario", receive).then(register),
    ]).then(() => { if (!disposed) void emit("work-os://debug-request"); }).catch(() => undefined);
    return () => { disposed = true; cleaners.forEach((off) => off()); };
  }, []);
  return scenario;
}

interface RuntimeInput extends MascotSignals {
  window: "main" | "avatar";
  scope: string;
  facts: MascotPlatformFacts;
  scenario: DebugScenario;
  /** Changes only for a newly confirmed outcome, never a restored transcript. */
  receipt?: unknown;
}

export function useMascotRuntime(input: RuntimeInput) {
  const [peer, setPeer] = useState<MascotActivityMessage | null>(null);
  const [receiptReady, setReceiptReady] = useState(false);
  const receiptRef = useRef({ scope: input.scope, value: input.receipt, pending: false });
  useEffect(() => {
    const previous = receiptRef.current;
    const scopeChanged = previous.scope !== input.scope;
    const pending = !scopeChanged && (previous.pending || (previous.value !== input.receipt && input.receipt != null));
    receiptRef.current = { scope: input.scope, value: input.receipt, pending };
    setReceiptReady(false);
    // Seed restored/scoped receipts without replay. A new confirmed outcome
    // waits until its request settles, so slow refreshes cannot eat the pulse.
    if (scopeChanged || !pending || input.working) return;
    receiptRef.current.pending = false;
    setReceiptReady(true);
    const timer = window.setTimeout(() => setReceiptReady(false), READY_MS);
    return () => window.clearTimeout(timer);
  }, [input.receipt, input.scope, input.working]);

  const localActivity = mascotActivityFromSignals({ ...input, completed: input.completed || receiptReady, failed: input.failed || !!input.facts.niftySyncError });
  const peerActivity = peer && acceptMascotActivity(peer, input.window, input.scope, Date.now()) ? peer.activity : undefined;
  const state = resolveMascotRuntime(input.facts, { ...input, completed: input.completed || receiptReady }, input.scenario, peerActivity);
  const stateKey = JSON.stringify(state);
  const latest = useRef({ ...input, localActivity, state });
  latest.current = { ...input, localActivity, state };
  useEffect(() => {
    publishMascotRuntime(latest.current.state);
    void emit("work-os://mascot-resolved", { window: input.window, state: latest.current.state });
  }, [stateKey, input.window]);

  useEffect(() => {
    if (!peer) return;
    const timer = window.setTimeout(() => setPeer(null), Math.max(0, peer.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [peer]);

  useEffect(() => {
    setPeer(null);
    let disposed = false;
    const cleaners: Array<() => void> = [];
    const register = (off: () => void) => { if (disposed) off(); else cleaners.push(off); };
    const send = () => {
      const value = latest.current;
      if (!value.scope || disposed) return;
      const now = Date.now();
      // Send local facts only, not the combined peer activity or debug override.
      void emit("work-os://mascot-activity", { window: value.window, scope: value.scope, activity: value.localActivity, sentAt: now, expiresAt: now + (value.localActivity === "ready" ? READY_MS : LEASE_MS) });
    };
    void Promise.all([
      listen<unknown>("work-os://mascot-activity", ({ payload }) => {
        if (disposed || !acceptMascotActivity(payload, input.window, input.scope, Date.now())) return;
        setPeer((previous) => previous && previous.sentAt > payload.sentAt ? previous : payload);
      }).then(register),
      listen<{ window?: string }>("work-os://mascot-request", ({ payload }) => {
        if (disposed || payload?.window === input.window) return;
        send();
        void emit("work-os://mascot-resolved", { window: input.window, state: latest.current.state });
      }).then(register),
    ]).then(() => {
      if (disposed) return;
      send();
      void emit("work-os://mascot-request", { window: input.window });
    }).catch(() => undefined);
    const heartbeat = window.setInterval(send, 8_000);
    return () => {
      disposed = true;
      cleaners.forEach((off) => off());
      window.clearInterval(heartbeat);
      const now = Date.now();
      if (input.scope) void emit("work-os://mascot-activity", { window: input.window, scope: input.scope, activity: "idle", sentAt: now, expiresAt: now + 1_000 });
    };
  }, [input.scope, input.window]);

  useEffect(() => {
    if (!input.scope) return;
    const now = Date.now();
    void emit("work-os://mascot-activity", { window: input.window, scope: input.scope, activity: localActivity, sentAt: now, expiresAt: now + (localActivity === "ready" ? READY_MS : LEASE_MS) });
  }, [localActivity, input.scope, input.window]);
  useEffect(() => () => publishMascotRuntime(null), []);
  return state;
}

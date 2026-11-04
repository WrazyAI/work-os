import type { DayData } from "./types";

export function monitorDaySnapshot(day: DayData): DayData {
  const { evidence: _evidence, proposals: _proposals, taskHistory: _history, workspaceSummary: _workspace, ...status } = day;
  return { ...status, tasks: (day.tasks ?? []).slice(0, 24).map((task) => ({
    id: task.id, provider_task_id: task.provider_task_id, title: task.title,
    completed: task.completed, due_date: task.due_date, subtaskProgress: task.subtaskProgress,
    subtasks: (task.subtasks ?? []).slice(0, 24).map((child: Record<string, unknown>) => ({ id: child.id, title: child.title, completed: child.completed })),
  })) } as unknown as DayData;
}

type Transport = {
  claim: () => Promise<boolean>;
  read: () => Promise<string | null>;
  publish: (snapshot: string) => Promise<boolean>;
  release: () => Promise<void>;
  listen: (receive: (scope: string) => void) => Promise<() => void>;
};

/** The host arbitrates across webviews; each client fences late callbacks. */
export function createDayMonitorClient(input: {
  scope: string; window: "main" | "avatar"; transport: Transport;
  onOwner: (owns: boolean) => void; onSnapshot: (day: DayData) => void;
}) {
  let stopped = false;
  let off: (() => void) | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let owns = false;
  const isOwner = async () => {
    if (stopped) return false;
    const next = await input.transport.claim().catch(() => false);
    if (stopped) {
      // A late claim must not leave the host lease pointing at a window that
      // has already retired its scope.
      if (next) await input.transport.release().catch(() => undefined);
      return false;
    }
    if (next !== owns) { owns = next; input.onOwner(next); }
    return next;
  };
  const read = async () => {
    const snapshot = await input.transport.read().catch(() => null);
    if (stopped || !snapshot) return;
    try { input.onSnapshot(JSON.parse(snapshot)); } catch { /* next refresh recovers */ }
  };
  return {
    isOwner,
    async start() {
      const unsubscribe = await input.transport.listen((scope) => { if (scope === input.scope) void read(); });
      if (stopped) { unsubscribe(); return; }
      off = unsubscribe;
      await isOwner();
      await read();
      if (!stopped) timer = setInterval(() => { void isOwner().then(() => read()); }, 10_000);
    },
    async publish(day: DayData) {
      if (stopped || !await isOwner()) return false;
      const published = await input.transport.publish(JSON.stringify(monitorDaySnapshot(day)));
      if (!published && !stopped && owns) { owns = false; input.onOwner(false); }
      return published;
    },
    async stop() {
      stopped = true; off?.(); if (timer) clearInterval(timer);
      await input.transport.release().catch(() => undefined);
    },
  };
}

export type ViewWorkFence = {
  capture: () => { signal: AbortSignal; isCurrent: () => boolean; release: () => void };
  invalidate: () => void;
};

/** One synchronous fence per host. A view or session boundary invalidates every
 * continuation captured before it; callers can also release their own work
 * without disturbing a newer generation. */
export function createViewWorkFence(): ViewWorkFence {
  let generation = 0;
  let controller = new AbortController();
  return {
    capture() {
      const captured = generation;
      const local = controller;
      return {
        signal: local.signal,
        isCurrent: () => captured === generation && !local.signal.aborted,
        release: () => {
          if (captured !== generation) return;
          generation += 1;
          local.abort();
          controller = new AbortController();
        },
      };
    },
    invalidate() {
      generation += 1;
      controller.abort();
      controller = new AbortController();
    },
  };
}

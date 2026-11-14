/** macOS uses the system WebKit, not the Chrome version used by Windows.
 * Install only missing request-cancellation helpers before API consumers run.
 * Keep native implementations on newer engines; never remove request deadlines
 * or query cancellation just because an older WebKit lacks the static helpers.
 */
export function installRequestAbortCompatibility() {
  if (typeof AbortSignal.timeout !== "function") {
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true,
      writable: true,
      value: (milliseconds: number): AbortSignal => {
        if (!Number.isInteger(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
          throw new RangeError("Request timeout must be a nonnegative 32-bit integer.");
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new DOMException("The request timed out.", "TimeoutError")), milliseconds);
        // Node fixtures must not stay alive for a browser request's deadline.
        if (typeof timer === "object" && "unref" in timer) timer.unref();
        return controller.signal;
      },
    });
  }
  if (typeof AbortSignal.any !== "function") {
    Object.defineProperty(AbortSignal, "any", {
      configurable: true,
      writable: true,
      value: (signals: AbortSignal[]): AbortSignal => {
        const controller = new AbortController();
        const listeners = new Map<AbortSignal, () => void>();
        const abort = (signal: AbortSignal) => {
          controller.abort(signal.reason);
          for (const [source, listener] of listeners) source.removeEventListener("abort", listener);
          listeners.clear();
        };
        for (const signal of signals) {
          if (signal.aborted) {
            abort(signal);
            break;
          }
          if (!listeners.has(signal)) {
            const listener = () => abort(signal);
            listeners.set(signal, listener);
            signal.addEventListener("abort", listener, { once: true });
          }
        }
        return controller.signal;
      },
    });
  }
}

installRequestAbortCompatibility();

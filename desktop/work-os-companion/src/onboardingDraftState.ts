export type DraftSaveState = "saved" | "saving" | "offline" | "conflict";

/** A server response is state metadata, not permission to replace a user's
 * in-progress form. Rehydrate only for a different signed-in identity/reset. */
export function onboardingHydrationKey(input: { email: string }) {
  return input.email.trim().toLowerCase();
}

export function shouldHydrateOnboardingForm(previous: string | null, next: string) {
  return previous !== next;
}

/** Serialize network writes and retain only the newest state that arrived
 * while a write was in flight. This makes old responses unable to overtake
 * later typing and avoids a request per keystroke. */
export function createCoalescedDraftQueue<T>(save: (input: T) => Promise<void>) {
  let latest: T | null = null;
  let inFlight: Promise<void> | null = null;
  return {
    enqueue(input: T) {
      latest = input;
      if (inFlight) return inFlight;
      const drain = async () => {
        do {
          const next = latest;
          latest = null;
          if (next !== null) await save(next);
        } while (latest !== null);
      };
      inFlight = drain().finally(() => { inFlight = null; });
      return inFlight;
    },
  };
}

import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";

/**
 * Admin Otto's query namespace.
 *
 * Every key starts with the actor and organization that owns the read, so a
 * sign-in as another account can never reuse the previous account's cached
 * team record. The `admin` segment also keeps these queries out of the
 * companion's encrypted on-disk cache (`isPersistedQueryKey`): administration
 * data belongs to the live workspace, not to this device's employee session.
 */
export type AdminOttoQueryKey = readonly [
  "work-os",
  "admin",
  "otto",
  organizationId: string,
  userId: string,
  ...rest: string[],
];

function root(scope: OttoScope): readonly ["work-os", "admin", "otto", string, string] {
  return ["work-os", "admin", "otto", scope.organizationId, scope.userId] as const;
}

export function adminOttoKeys(scope: OttoScope) {
  const base = root(scope);
  return {
    /** The authoritative context bootstrap for this actor/organization. */
    context: [...base, "context"] as AdminOttoQueryKey,
    /** Every followed-inbox page for this actor/organization. Prefix a save
     * invalidation with this; the per-cursor keys below still address one page. */
    inboxRoot: [...base, "inbox"] as AdminOttoQueryKey,
    inbox: (cursor: string | null = null) => [...base, "inbox", cursor ?? "first"] as AdminOttoQueryKey,
    /** Bounded active-directory pages used by the follow checklist. */
    peopleRoot: [...base, "people"] as AdminOttoQueryKey,
    people: (cursor: string | null = null) => [...base, "people", cursor ?? "first"] as AdminOttoQueryKey,
    preferences: [...base, "preferences"] as AdminOttoQueryKey,
    chat: (conversationId: string | null = null) => [...base, "chat", conversationId ?? "new"] as AdminOttoQueryKey,
    recap: (intervalId: string) => [...base, "recap", intervalId] as AdminOttoQueryKey,
    speech: (intervalId: string, reviewKey: string) => [...base, "speech", intervalId, reviewKey] as AdminOttoQueryKey,
    delivery: [...base, "delivery"] as AdminOttoQueryKey,
  } as const;
}

import type { FollowSettings, OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";
import { listen } from "../tauriEvents";

/** A cross-window signal only. It carries who changed and which opaque ids
 * were chosen — never a recap, token, employee name, or shared global
 * settings. Both the main and avatar windows use the same production listener;
 * each compares it with its own live scope before waking the existing delivery
 * or inbox source. */
export const ADMIN_OTTO_FOLLOW_CHANGED_EVENT = "work-os://admin-otto-follow-changed";

export type AdminOttoFollowChanged = {
  scope: OttoScope;
  mode: "all" | "selected";
  personIds: string[];
  revision: number;
};

function scopeValue(value: unknown): OttoScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scope = value as Record<string, unknown>;
  if (typeof scope.userId !== "string" || !scope.userId) return null;
  if (typeof scope.organizationId !== "string" || !scope.organizationId) return null;
  if (scope.mode !== "admin" && scope.mode !== "employee") return null;
  return { userId: scope.userId, organizationId: scope.organizationId, mode: scope.mode };
}

export function adminOttoFollowChangedEvent(scope: OttoScope, settings: FollowSettings): AdminOttoFollowChanged {
  return {
    scope: { ...scope },
    mode: settings.mode === "selected" ? "selected" : "all",
    personIds: (Array.isArray(settings.personIds) ? settings.personIds : [])
      .filter((id): id is string => typeof id === "string" && id.length > 0),
    revision: settings.revision,
  };
}

export function parseAdminOttoFollowChangedEvent(value: unknown): AdminOttoFollowChanged | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  const scope = scopeValue(event.scope);
  if (!scope) return null;
  if (event.mode !== "all" && event.mode !== "selected") return null;
  if (!Array.isArray(event.personIds) || event.personIds.length > 500) return null;
  if (event.personIds.some((id) => typeof id !== "string" || !id)) return null;
  if (typeof event.revision !== "number" || !Number.isSafeInteger(event.revision) || event.revision < 0) return null;
  return {
    scope,
    mode: event.mode,
    personIds: event.personIds as string[],
    revision: event.revision,
  };
}

export function adminOttoFollowChangedAppliesTo(event: AdminOttoFollowChanged | null, scope: OttoScope): boolean {
  return !!event && event.scope.userId === scope.userId
    && event.scope.organizationId === scope.organizationId
    && event.scope.mode === scope.mode;
}

/** Subscribe through the production event adapter. The callback receives only
 * parsed IDs/context events; each window still checks its live scope with
 * `adminOttoFollowChangedAppliesTo` before refreshing. */
export async function listenAdminOttoFollowChanged(
  handler: (event: AdminOttoFollowChanged) => void,
): Promise<() => void> {
  return listen<Record<string, unknown>>(ADMIN_OTTO_FOLLOW_CHANGED_EVENT, (event) => {
    const changed = parseAdminOttoFollowChangedEvent(event.payload);
    if (changed) handler(changed);
  });
}

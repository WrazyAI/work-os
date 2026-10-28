import type { OttoScope } from "../../../../src/modules/work-os/admin-otto/contracts";

/**
 * Scope identity without the object identity.
 *
 * Hosts rebuild an equal scope object on every render (`audioScope={query.data
 * ? { ... } : null}`). Beginning playback with that object as a dependency would
 * dispose the player and release its lease on every unrelated re-render, so the
 * hook keys on these fields instead. Only a real actor/organization/mode change
 * is a new audio scope.
 */
export function recapAudioScopeKey(scope: OttoScope | null): string {
  if (!scope) return "";
  return `${scope.userId}\u0000${scope.organizationId}\u0000${scope.mode}`;
}

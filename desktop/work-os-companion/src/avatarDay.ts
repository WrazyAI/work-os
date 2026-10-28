import type { PersonalBootstrapAccess } from "./adminOtto/personalBootstrap";

export type AvatarDayAccess = "load" | "unmapped" | "wait";

/**
 * What the floating companion does with the personal-bootstrap gate.
 *
 * A missing membership answer is not an administration denial: `/me/day`
 * authorizes itself with the same session, so employees still load today while
 * the auxiliary gate recovers. An unmapped administrator has no workday to
 * load, but must still settle instead of waiting on a read that will never run.
 */
export function avatarDayAccess(access: PersonalBootstrapAccess | null): AvatarDayAccess {
  if (!access) return "load";
  if (access.day) return "load";
  return access.reason === "admin_unmapped" ? "unmapped" : "wait";
}

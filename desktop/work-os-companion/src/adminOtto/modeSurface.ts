export type AdminOttoSurfaceState = {
  entryOpen: boolean;
  conversationId: string | null;
};

export function clearAdminOttoSurface(reason: "mode_switch" | "dispose" = "mode_switch", conversationId: string | null = null): AdminOttoSurfaceState {
  return { entryOpen: false, conversationId: reason === "dispose" ? conversationId : null };
}

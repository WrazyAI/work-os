export type AdminOttoSurfaceState = {
  entryOpen: boolean;
  conversationId: string | null;
};

export function clearAdminOttoSurface(reason: "mode_switch" | "dispose" = "mode_switch", conversationId: string | null = null): AdminOttoSurfaceState {
  // A view switch closes the visible surface; it is not New chat. Retaining
  // the id lets a returning view hydrate the same thread.
  return { entryOpen: false, conversationId };
}

/** Whether the one-time theme prompt may open. The caller owns the timing
 * (the first workspace paint) and the dev override; this gate only answers the
 * product question. */
export type ThemePromptGate = {
  signedIn: boolean;
  themePromptSeen: boolean;
  workspaceOnScreen: boolean;
  otherOverlayOpen: boolean;
  hasSession: boolean;
};

export function shouldOpenThemePrompt(gate: ThemePromptGate): boolean {
  return gate.signedIn && !gate.themePromptSeen && gate.workspaceOnScreen && !gate.otherOverlayOpen && gate.hasSession;
}

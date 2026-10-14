import { ArrowUpRight } from "lucide-react";
import { forwardRef } from "react";
import { MASCOT } from "../mascot";
import { MascotMark } from "./MascotMark";

export type ConversationLauncherMode = "progress" | "agenda";

/**
 * The quiet, collapsed entry point for the in-app assistant. The launcher is
 * intentionally not a miniature composer: it gives the page back its task
 * space and lets the conversation surface own the interaction once opened.
 */
export const ConversationLauncher = forwardRef<HTMLButtonElement, {
  mode: ConversationLauncherMode;
  required?: boolean;
  onOpen: () => void;
}>(({ mode, required = false, onOpen }, ref) => {
  const title = required ? "Update due" : mode === "agenda" ? "Add a task" : "Share an update";
  const detail = required
    ? `Tell ${MASCOT.name} what changed`
    : mode === "agenda"
      ? `Chat with ${MASCOT.name} about it`
      : `${MASCOT.name} is ready when you are`;

  return (
    <button
      ref={ref}
      type="button"
      className={`conversation-launcher${mode === "agenda" ? " is-agenda" : ""}${required ? " is-required" : ""}`}
      aria-label={`Open ${MASCOT.name} ${mode === "agenda" ? "task planner" : "update composer"}`}
      aria-expanded="false"
      aria-controls="conversation-panel"
      data-conversation-launcher
      onClick={onOpen}
    >
      <span className="conversation-launcher-mark" aria-hidden="true">
        <MascotMark pose={required ? "alert" : mode === "agenda" ? MASCOT.idlePose : MASCOT.chatPose} />
      </span>
      <span className="conversation-launcher-copy">
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="conversation-launcher-action" aria-hidden="true">
        <ArrowUpRight size={16} strokeWidth={2.2} />
      </span>
    </button>
  );
});

ConversationLauncher.displayName = "ConversationLauncher";

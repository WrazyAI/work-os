import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { ChatMarkdown } from "../ChatMarkdown";
import { CopyMessageButton } from "./CopyMessageButton";
import { MascotMark } from "./MascotMark";
import { cx } from "./cx";
import { StreamingText } from "./StreamingText";
import { formatChatClock, formatChatDividerLabel, formatChatTimeTitle } from "./timeNotes";
import { turnCopyText, type CopyableTurn } from "./turnCopy";

export type ChatTurnRole = "user" | "assistant" | "system";

/** Shared conversation turn for the in-app dock and floating companion. */
export function ChatTurn({
  role,
  text,
  meta,
  stream = false,
  receipt = false,
  onSettled,
  onRetry,
  className,
  showMark = true,
  variant = "message",
  children,
  copySource,
  actions,
  timestamp,
}: {
  role: ChatTurnRole;
  text?: string;
  meta?: string | null;
  stream?: boolean;
  receipt?: boolean;
  onSettled?: () => void;
  onRetry?: () => void;
  className?: string;
  /** Keep the message rhythm while showing the mascot once per assistant cluster. */
  showMark?: boolean;
  /** A tool surface owns the full turn width and carries its own status tile
   * instead of sitting in the message column beside the mascot mark. */
  variant?: "message" | "tool";
  children?: ReactNode;
  /** Turn data for the copy payload when the visible content includes cards. */
  copySource?: CopyableTurn;
  /** Extra hover actions beside Copy, for turn-specific destinations such as the
   * recap stream behind a recap summary. */
  actions?: ReactNode;
  /** The turn's recorded creation time. Agent turns reveal it rightmost in their
   * hover row; employee bubbles never do (their sent time is the session
   * divider's job), and a missing value shows nothing rather than a guess. */
  timestamp?: string | null;
}) {
  const copyText = turnCopyText(copySource ?? { role, text });
  // The hover clock follows the actions, so the row reads `Copy`, any
  // destination action, then the local time — and never shifts the thread.
  const clock = role === "assistant" ? formatChatClock(timestamp) : null;
  // The row reserves its strip and reveals on hover, so adding an action never
  // shifts the thread and never requires the copy control to be present.
  const actionRow = copyText || actions ? (
    <div className="chat-copy-row">
      {copyText ? <CopyMessageButton text={copyText} /> : null}
      {actions}
      {clock ? <time className="chat-turn-time" dateTime={timestamp ?? undefined} title={formatChatTimeTitle(timestamp) ?? undefined}>{clock}</time> : null}
    </div>
  ) : null;
  if (role === "user") {
    return (
      <div className={cx("chat-turn-shell is-user chat-enter", className)}>
        <div className="chat-turn-user">
          {text ? <ChatMarkdown text={text} /> : children}
        </div>
        {actionRow}
      </div>
    );
  }

  if (role === "system") {
    return (
      <div className={cx("chat-system-notice chat-enter", className)} role="status">
        {text ? <ChatMarkdown text={text} /> : children}
      </div>
    );
  }

  const showTurnMark = showMark && variant !== "tool";
  return (
    <div className={cx("chat-turn-shell", variant === "tool" && "is-tool", "chat-enter", className)}>
      <div className={receipt ? "chat-receipt" : "chat-turn assistant"}>
        <span className={cx("chat-turn-mark", !showTurnMark && "is-hidden")} aria-hidden="true">
          {showTurnMark ? (receipt ? <CheckCircle2 size={14} /> : <MascotMark />) : null}
        </span>
        <div className="chat-turn-body">
          {meta ? <small className="chat-turn-note">{meta}</small> : null}
          {text ? (
            stream ? (
              <StreamingText text={text} stream onSettled={onSettled} onRetry={onRetry} />
            ) : (
              <ChatMarkdown text={text} />
            )
          ) : null}
          {children}
        </div>
      </div>
      {actionRow}
    </div>
  );
}

/** The centered session marker above an employee message: the conversation's
 * opening and every pause longer than twenty minutes. It is part of the thread —
 * not a hover affordance — and stays for the life of the conversation. */
export function ChatTimeDivider({ at, now }: { at?: string | null; now?: Date }) {
  const label = formatChatDividerLabel(at, now);
  if (!label) return null;
  return <div className="chat-time-divider"><time dateTime={at ?? undefined}>{label}</time></div>;
}

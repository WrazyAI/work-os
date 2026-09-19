import type { ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { ChatMarkdown } from "../ChatMarkdown";
import { CopyMessageButton } from "./CopyMessageButton";
import { MascotMark } from "./MascotMark";
import { cx } from "./cx";
import { StreamingText } from "./StreamingText";
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
  children,
  copySource,
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
  children?: ReactNode;
  /** Turn data for the copy payload when the visible content includes cards. */
  copySource?: CopyableTurn;
}) {
  const copyText = turnCopyText(copySource ?? { role, text });
  if (role === "user") {
    return (
      <div className={cx("chat-turn-shell is-user chat-enter", className)}>
        <div className="chat-turn-user">
          {text ? <ChatMarkdown text={text} /> : children}
        </div>
        {copyText ? <CopyMessageButton text={copyText} className="chat-copy-row" /> : null}
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

  return (
    <div className={cx("chat-turn-shell", "chat-enter", className)}>
      <div className={receipt ? "chat-receipt" : "chat-turn assistant"}>
        <span className={cx("chat-turn-mark", !showMark && "is-hidden")} aria-hidden="true">
          {showMark ? (receipt ? <CheckCircle2 size={14} /> : <MascotMark />) : null}
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
      {copyText ? <CopyMessageButton text={copyText} className="chat-copy-row" /> : null}
    </div>
  );
}

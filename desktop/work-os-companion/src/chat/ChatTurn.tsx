import type { ReactNode } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { ChatMarkdown } from "../ChatMarkdown";
import { cx } from "./cx";
import { StreamingText } from "./StreamingText";

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
  children,
}: {
  role: ChatTurnRole;
  text?: string;
  meta?: string | null;
  stream?: boolean;
  receipt?: boolean;
  onSettled?: () => void;
  onRetry?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  if (role === "user") {
    return (
      <div className={cx("chat-turn-user chat-enter", className)}>
        {text ? <ChatMarkdown text={text} /> : children}
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
    <div className={cx(receipt ? "chat-receipt" : "chat-turn assistant", "chat-enter", className)}>
      <span className="chat-turn-mark" aria-hidden="true">
        {receipt ? <CheckCircle2 size={14} /> : <Sparkles size={14} />}
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
  );
}

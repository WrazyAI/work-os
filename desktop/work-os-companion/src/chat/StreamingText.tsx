import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ChatMarkdown } from "../ChatMarkdown";
import { cx } from "./cx";

const WORD_MS = 32;
const MAX_STREAM_TOKENS = 240;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/** Reveals a real assistant reply word-by-word out of a soft blur. The full
 *  text is exposed once to screen readers; the animated copy is aria-hidden.
 *  Under reduced motion (or very long replies) it renders instantly. */
export function StreamingText({
  text,
  stream,
  onSettled,
  onRetry,
}: {
  text: string;
  stream: boolean;
  onSettled?: () => void;
  /** Only provided when the parent can actually resend — no fake retry. */
  onRetry?: () => void;
}) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const canStream = stream && tokens.length <= MAX_STREAM_TOKENS && !prefersReducedMotion();
  const [count, setCount] = useState(() => (canStream ? 0 : tokens.length));
  const settledRef = useRef(false);

  useEffect(() => {
    if (!canStream) {
      setCount(tokens.length);
      return;
    }
    setCount(0);
    settledRef.current = false;
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setCount(index);
      if (index >= tokens.length) {
        clearInterval(timer);
        if (!settledRef.current) {
          settledRef.current = true;
          onSettled?.();
        }
      }
    }, WORD_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokens, canStream]);

  const done = count >= tokens.length;
  const revealed = done ? text : tokens.slice(0, count).join("");
  const progress = tokens.length ? count / tokens.length : 1;
  const blur = done ? 0 : Math.max(0, (1 - progress) * 2.2);


  return (
    <div className="chat-stream w-full min-w-0">
      <span className="sr-only" aria-live="polite">{text}</span>
      <div aria-hidden="true" style={{ filter: `blur(${blur}px)`, transition: "filter 120ms linear" }}>
        <ChatMarkdown text={revealed} />
        {!done && (
          <span className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 animate-pulse rounded-full bg-ink align-middle" />
        )}
      </div>
      {done && onRetry && (
        <div
          className="chat-stream-actions chat-enter-fast mt-1.5 flex items-center gap-0.5"
        >
          <button type="button" className="chat-icon-button size-6" aria-label="Resend" onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Assistant section wrapper: an optional meta line built only from real data,
 *  then the body. Resolving sections ease out of a soft blur. */
export function ChatSection({
  label,
  sub,
  time,
  resolving = false,
  className,
  children,
}: {
  label?: string;
  sub?: string;
  time?: string;
  resolving?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "chat-section chat-enter flex w-full min-w-0 flex-col gap-1.5",
        resolving && "opacity-55 blur-[0.5px]",
        className,
      )}
    >
      {(label || sub || time) && (
        <div className="flex items-center gap-1 text-[12px] leading-[1.3]">
          {label && <span className="font-medium text-ink">{label}</span>}
          {sub && <span className="text-ink-2">{sub}</span>}
          {time && <span className="text-ink">{time}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

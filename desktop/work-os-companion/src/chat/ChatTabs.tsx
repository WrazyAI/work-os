import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { cx } from "./cx";
import type { ChatTab } from "./core";

/** Peer-view tabs: switch views in the same context, never mutate (§9.2).
 *  Keyboard: ←/→ wrap, Home/End jump. */
export function ChatTabs({
  tabs,
  active,
  onSelect,
  ariaLabel,
}: {
  tabs: ChatTab[];
  active: string;
  onSelect: (id: string) => void;
  ariaLabel: string;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (event: ReactKeyboardEvent, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    onSelect(tabs[next].id);
    buttonRefs.current[next]?.focus();
  };
  return (
    <div className="chat-tabs flex min-w-0 items-center gap-0.5" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(tab.id)}
            onKeyDown={(event) => move(event, index)}
            className={cx(
              "chat-tab inline-flex w-auto items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 py-1 text-[13px] font-semibold leading-[1.4] text-ink transition-[background-color,opacity] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal-strong",
              selected ? "bg-field opacity-100" : "opacity-50 hover:opacity-75",
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && tab.count > 0 && (
              <span
                className="chat-tab-count min-w-[18px] rounded-full bg-inset px-1.5 py-px text-center text-[10px] font-bold tabular-nums text-ink-2"
                aria-label={`${tab.count} open`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

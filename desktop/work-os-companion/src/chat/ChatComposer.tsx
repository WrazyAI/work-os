import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Plus } from "lucide-react";
import { GlideMenu, type GlideRow } from "./GlideMenu";
import {
  WORK_OS_CHAT_SOURCES,
  isWideDraft,
  parseChatToken,
  type WorkOsChatCommand,
  type WorkOsChatSource,
} from "./core";

/**
 * The shared Work OS composer (design §25.11): context (+), @ sources,
 * / commands, a growing field, an optional labeled footer action, and a dark
 * ink send. Parent owns the draft value and send authority; this owns only
 * menu/disclosure state so both delivery surfaces stay identical.
 */
export function ChatComposer({
  value,
  onChange,
  onSend,
  placeholder,
  ariaLabel,
  canSend,
  busy = false,
  autoFocus = false,
  maxLength = 4000,
  sources = WORK_OS_CHAT_SOURCES,
  commands = [],
  footerLeft = null,
  onFocus,
  onPlus,
  sendLabel = "Send",
  plusLabel = "Add Work OS context and commands",
  sweepSignal = 0,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;
  placeholder: string;
  ariaLabel: string;
  canSend: boolean;
  busy?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  sources?: WorkOsChatSource[];
  commands?: WorkOsChatCommand[];
  footerLeft?: ReactNode;
  onFocus?: () => void;
  /** Open the owning surface before revealing the context menu. */
  onPlus?: () => void;
  sendLabel?: string;
  plusLabel?: string;
  /** Increment to replay the sweep (e.g. when a reply settles). */
  sweepSignal?: number;
  className?: string;
}) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const token = dismissed ? null : parseChatToken(value);
  const menu: "at" | "slash" | null = plusOpen ? "at" : (token?.kind ?? null);
  const query = plusOpen ? "" : (token?.query ?? "");

  const rows: GlideRow[] =
    menu === "at"
      ? sources
          .filter((source) => source.name.toLowerCase().includes(query))
          .map((source) => ({
            key: source.key,
            icon: source.icon,
            name: `@${source.name}`,
            desc: source.desc,
          }))
      : menu === "slash"
        ? commands
            .filter((command) => command.name.slice(1).startsWith(query))
            .map((command) => ({ key: command.key, name: command.name, desc: command.desc }))
        : [];

  useEffect(() => {
    setActive(0);
    setEngaged(false);
  }, [menu, query]);

  /* The field grows with content to a maximum. */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, 36), 100)}px`;
    input.style.overflowY = contentHeight > 100 ? "auto" : "hidden";
  }, [value, fitKey]);

  /* Refit when the surface itself changes size or late fonts load. */
  useEffect(() => {
    const refit = () => setFitKey((key) => key + 1);
    window.addEventListener("resize", refit);
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) refit();
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", refit);
    };
  }, []);

  /* The menu is a detached surface portaled to the body: fixed positioning
     measured from the composer keeps it clear of every scroll container and
     overflow boundary in both delivery surfaces. */
  useLayoutEffect(() => {
    if (!menu) {
      setAnchor(null);
      return;
    }
    const update = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      setAnchor({ left: rect.left, top: rect.top, width: rect.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [menu]);

  /* Clicking outside the composer closes the open menus. The menu itself is
     portaled to the body, so it is exempt alongside the promptbar. */
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest("[data-workos-promptbar], [data-workos-chat-menu]")) {
        setPlusOpen(false);
        setDismissed(true);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const closeMenus = () => {
    setPlusOpen(false);
    setDismissed(true);
  };

  const pick = (row: GlideRow) => {
    if (menu === "slash") {
      const command = commands.find((item) => item.key === row.key);
      if (command?.run) {
        closeMenus();
        command.run();
        return;
      }
      const text = command?.insert ?? `${row.name} `;
      applyText(text);
      return;
    }
    const source = sources.find((item) => item.key === row.key);
    applyText(source?.insert ?? `${row.name} `);
  };

  const applyText = (text: string) => {
    if (token) onChange(value.slice(0, token.start) + text);
    else onChange(value + (value && !value.endsWith(" ") ? " " : "") + text);
    setPlusOpen(false);
    setDismissed(false);
    setActive(0);
    inputRef.current?.focus();
  };

  const send = () => {
    if (!canSend || busy) return;
    closeMenus();
    onSend();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (menu && rows.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setEngaged(true);
        setActive((current) => (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
        return;
      }
      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
        event.preventDefault();
        pick(rows[active] ?? rows[0]);
        return;
      }
    }
    if (event.key === "Escape") {
      if (menu) {
        event.stopPropagation();
        closeMenus();
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  };

  const wide = isWideDraft(value, !!footerLeft);
  const hasFooter = !!footerLeft;
  const menuLabel = menu === "at" ? "Work OS context" : "Work OS commands";

  return (
    <div ref={rootRef} data-workos-promptbar className={`relative w-full min-w-0 ${className ?? ""}`}>
      {menu && anchor && createPortal(
        <GlideMenu
          rows={rows}
          active={active}
          engaged={engaged}
          label={menuLabel}
          className="overflow-y-auto rounded-[10px] border border-line bg-white p-1 shadow-raised"
          style={{
            position: "fixed",
            left: anchor.left,
            width: anchor.width,
            bottom: window.innerHeight - anchor.top + 8,
            maxHeight: Math.max(180, Math.min(264, anchor.top - 16)),
            /* The in-app dock owns z-index 90; the detached menu must sit
               above that surface or its rows can look visible but lose clicks. */
            zIndex: 120,
          }}
          emptyText={`No matches for “${query}”`}
          footText={menu === "at" ? "Type to filter Work OS context" : "Type to filter commands"}
          onHoverRow={(index) => {
            setActive(index);
            setEngaged(true);
          }}
          onPick={(row) => pick(row)}
        />,
        document.body,
      )}

      <div
        className={`chat-composer relative isolate flex flex-col overflow-hidden border border-line bg-white shadow-card transition-[border-color,border-radius] duration-150 focus-within:border-line-strong ${
          wide ? "gap-2.5 rounded-[18px] p-3" : "gap-1.5 rounded-[16px] p-1.5"
        }`}
        data-sweep-signal={sweepSignal}
      >
        <div
          className={`grid items-end gap-x-1 gap-y-1.5 ${
            wide && hasFooter
              ? "grid-cols-[36px_auto_minmax(0,1fr)_36px]"
              : "grid-cols-[36px_minmax(0,1fr)_36px]"
          }`}
        >
          <button
            type="button"
            aria-label={plusLabel}
            aria-expanded={plusOpen}
            onClick={() => {
              if (!plusOpen) onPlus?.();
              setDismissed(false);
              setPlusOpen((current) => !current);
              inputRef.current?.focus();
            }}
            className={`flex size-9 shrink-0 items-center justify-center justify-self-start rounded-[9px] text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal-strong ${
              plusOpen ? "bg-hover text-ink" : ""
            } ${wide ? "col-start-1 row-start-2" : "col-start-1 row-start-1"}`}
          >
            <Plus size={16} strokeWidth={2} aria-hidden="true" />
          </button>

          <textarea
            ref={inputRef}
            rows={1}
            value={value}
            maxLength={maxLength}
            autoFocus={autoFocus}
            onChange={(event) => {
              onChange(event.target.value);
              setDismissed(false);
              setPlusOpen(false);
            }}
            onFocus={onFocus}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className={`min-h-9 min-w-0 w-full resize-none bg-transparent px-1 py-[7px] text-[13px] leading-[18px] text-ink outline-none placeholder:text-ink-3 [overflow-wrap:anywhere] ${
              wide ? "col-span-full col-start-1 row-start-1" : "col-start-2 row-start-1"
            }`}
          />

          {footerLeft && (
            <span
              className={
                wide
                  ? "col-start-2 row-start-2 justify-self-start"
                  : "col-start-3 row-start-1 justify-self-start"
              }
            >
              {footerLeft}
            </span>
          )}

          <button
            type="button"
            aria-label={sendLabel}
            aria-keyshortcuts="Enter"
            disabled={!canSend || busy}
            onClick={send}
            className={`flex size-9 shrink-0 items-center justify-center rounded-[11px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-strong disabled:cursor-default ${
              wide && hasFooter ? "col-start-4 row-start-2" : "col-start-3 row-start-1"
            } ${canSend && !busy ? "bg-ink text-white hover:-translate-y-px" : "bg-line text-ink-2"}`}
          >
            <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

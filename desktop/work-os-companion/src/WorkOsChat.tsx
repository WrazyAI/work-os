import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  CalendarDays,
  ListChecks,
  MessageSquareText,
  Pencil,
  Plus,
  ShieldCheck,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────
 * WORK OS CHAT — shared panel/composer language for the
 * in-app dock and the floating companion.
 *
 * One interaction, two delivery surfaces (design §28): the
 * header carries context tabs + actions, the thread keeps a
 * fixed scroll region with right-aligned user bubbles and
 * sectioned assistant replies, and the composer offers real
 * controls — context (+) , @ sources, / commands, send.
 *
 * Deliberate deviations from the reference exploration:
 * - No autoplay demo, no dictation, no model picker, no
 *   rainbow sweep: ambient motion and saturated multicolor
 *   gradients violate §§2.6/6.4, and unbacked controls would
 *   violate truthful provenance (§2.4).
 * - Lucide icons throughout (§8.1), semantic Work OS tokens,
 *   36px square 11px-radius ink send (§28.1), 220ms motion
 *   with the product easing (§14).
 * ───────────────────────────────────────────────────────── */

/** The last @word or /word being typed, if any. */
export interface ChatToken {
  kind: "at" | "slash";
  query: string;
  start: number;
}

export function parseChatToken(draft: string): ChatToken | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(draft);
  if (!match) return null;
  return {
    kind: match[2] === "@" ? "at" : "slash",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

export interface WorkOsChatSource {
  key: string;
  name: string;
  desc: string;
  icon: ReactNode;
}

/** Work OS data the assistant can already see — mentioning it only
 *  names the context in plain text; nothing is fetched or attached. */
export const WORK_OS_CHAT_SOURCES: WorkOsChatSource[] = [
  { key: "tasks", name: "Today's tasks", desc: "Titles, status, and due dates", icon: <ListChecks size={15} aria-hidden="true" /> },
  { key: "focus", name: "Today's focus", desc: "The current goal note", icon: <Pencil size={15} aria-hidden="true" /> },
  { key: "eod", name: "EOD review", desc: "Draft and submission state", icon: <MessageSquareText size={15} aria-hidden="true" /> },
  { key: "evidence", name: "Evidence", desc: "Provenance and timestamps", icon: <ShieldCheck size={15} aria-hidden="true" /> },
  { key: "day", name: "Day summary", desc: "Shift, session, and counts", icon: <CalendarDays size={15} aria-hidden="true" /> },
];

export interface WorkOsChatCommand {
  key: string;
  name: string;
  desc: string;
  /** Text inserted into the draft when picked (defaults to `name`). */
  insert?: string;
  /** Real action run instead of inserting text, when provided. */
  run?: () => void;
}

/**
 * Work OS slash commands. Text commands only preface the draft —
 * classification/approval still happen after send, so nothing is
 * silently inferred (§§18.2, 25.10). Commands with `run` perform the
 * explicit navigation the user asked for (§25.9).
 */
export function workOsChatCommands(
  overrides: Partial<Record<string, () => void>> = {},
): WorkOsChatCommand[] {
  const base: WorkOsChatCommand[] = [
    { key: "progress", name: "/progress", desc: "Log material progress", insert: "Progress: " },
    { key: "completed", name: "/completed", desc: "Claim completed work", insert: "Completed: " },
    { key: "blocker", name: "/blocker", desc: "Record a blocker", insert: "Blocked: " },
    { key: "priority", name: "/priority", desc: "Note a priority change", insert: "Priority change: " },
    { key: "new-task", name: "/new-task", desc: "Add a task to today", insert: "New task: " },
    { key: "tasks", name: "/tasks", desc: "Show pending tasks", insert: "Show my pending tasks " },
    { key: "focus", name: "/focus", desc: "Open the focus editor" },
    { key: "eod", name: "/eod", desc: "Open EOD review" },
  ];
  return base.map((command) =>
    overrides[command.key] ? { ...command, run: overrides[command.key] } : command,
  );
}

export interface ChatTab {
  id: string;
  label: string;
  count?: number;
}

/** Peer-view tabs: switch views in the same context, never mutate (§9.2). */
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
    <div className="workos-chat-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(el) => {
            buttonRefs.current[index] = el;
          }}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          tabIndex={active === tab.id ? 0 : -1}
          className={active === tab.id ? "active" : ""}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab.label}
          {typeof tab.count === "number" && tab.count > 0 && (
            <span className="workos-tab-count" aria-label={`${tab.count} open`}>
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

interface MenuRow {
  key: string;
  name: string;
  desc: string;
  icon?: ReactNode;
  insert?: string;
  run?: () => void;
}

/** Two-row composer layout for multi-line drafts (or the labeled
 *  Focus action). Deliberately derived from the draft value only —
 *  measuring the field feeds back into the next measurement and
 *  oscillates as placeholder wrap changes with width. */
export function isWideDraft(value: string, hasFooter: boolean): boolean {
  return value.includes("\n") || hasFooter;
}

export interface CollapsibleTurn {
  role: string;
  text: string;
  operations?: unknown;
  toolResults?: unknown;
}

/** Collapse consecutive identical assistant texts at render. Dupes reach
 * the thread through double-saves and history/live-echo overlap; hiding
 * later repeats heals them without rewriting persisted data. Turns
 * carrying proposals or results never collapse. */
export function collapseConsecutiveAssistantDuplicates<T extends CollapsibleTurn>(
  turns: readonly T[],
): T[] {
  const visible: T[] = [];
  for (const turn of turns) {
    const prev = visible[visible.length - 1];
    const text = turn.text.trim();
    if (
      prev &&
      prev.role === "assistant" &&
      turn.role === "assistant" &&
      text &&
      prev.text.trim() === text &&
      !prev.operations &&
      !turn.operations &&
      !prev.toolResults &&
      !turn.toolResults
    ) {
      continue;
    }
    visible.push(turn);
  }
  return visible;
}

/**
 * Prompt-bar composer: context (+), @ sources, / commands, send.
 * Parent owns the draft value and send authority; this owns only the
 * menu/disclosure state so both surfaces stay identical.
 */
export function WorkOsPromptBar({
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
  sendLabel = "Send",
  plusLabel = "Add Work OS context and commands",
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
  sendLabel?: string;
  plusLabel?: string;
}) {
  const [plusOpen, setPlusOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  // The avatar panel mounts while its window is still collapsed-sized and
  // only resizes after; without refitting, the first measurement sticks
  // until the next keystroke.
  const [fitKey, setFitKey] = useState(0);
  const [rowBox, setRowBox] = useState<{ top: number; height: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const token = dismissed ? null : parseChatToken(value);
  const menu: "at" | "slash" | null = plusOpen ? "at" : (token?.kind ?? null);
  const query = plusOpen ? "" : (token?.query ?? "");

  const rows: MenuRow[] =
    menu === "at"
      ? sources
          .filter((source) => source.name.toLowerCase().includes(query))
          .map((source) => ({
            key: source.key,
            name: `@${source.name}`,
            desc: source.desc,
            icon: source.icon,
            insert: `@${source.name} `,
          }))
      : menu === "slash"
        ? commands
            .filter((command) => command.name.slice(1).startsWith(query))
            .map((command) => ({ ...command }))
        : [];

  useEffect(() => {
    setActive(0);
    setEngaged(false);
  }, [menu, query]);

  /* One highlight glides to the active row instead of each row
   * toggling its own background. */
  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (menu && target) setRowBox({ top: target.offsetTop, height: target.offsetHeight });
    else setRowBox(null);
  }, [menu, query, active, rows.length]);

  /* The field grows with content to a maximum; the wide layout is
   * derived from the draft itself (never from measurement, which feeds
   * back into the next measurement and oscillates). */
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, 36), 100)}px`;
    input.style.overflowY = contentHeight > 100 ? "auto" : "hidden";
  }, [value, fitKey]);

  /* Refit when the surface itself changes size (avatar expand, window
   * resize) or late fonts change metrics. Measuring never resizes the
   * window, so this cannot feed back into itself. */
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

  /* Clicking outside the composer closes the open menus. */
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-workos-promptbar]")) {
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

  const pick = (row: MenuRow) => {
    if (row.run) {
      closeMenus();
      row.run();
    } else {
      const text = row.insert ?? `${row.name} `;
      if (token) onChange(value.slice(0, token.start) + text);
      else onChange(value + (value && !value.endsWith(" ") ? " " : "") + text);
      setPlusOpen(false);
      setDismissed(false);
    }
    setActive(0);
    inputRef.current?.focus();
  };

  const send = () => {
    if (!canSend || busy) return;
    closeMenus();
    onSend();
  };

  /* Multi-line drafts and the labeled Focus action take the roomy
   * two-row layout; a plain single line stays in one compact row. */
  const wide = isWideDraft(value, !!footerLeft);
  const menuLabel = menu === "at" ? "Work OS context" : "Work OS commands";

  return (
    <div ref={rootRef} data-workos-promptbar className="workos-promptbar">
      <div className="workos-composer-anchor">
        {menu && (
          <div
            className="workos-menu"
            role="listbox"
            aria-label={menuLabel}
            onMouseLeave={() => setEngaged(false)}
          >
            <span
              aria-hidden="true"
              className="workos-menu-glide"
              style={{
                top: rowBox?.top ?? 0,
                height: rowBox?.height ?? 0,
                opacity: rowBox && engaged && rows.length > 0 ? 1 : 0,
              }}
            />
            {rows.map((row, index) => (
              <button
                key={row.key}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => {
                  setActive(index);
                  setEngaged(true);
                }}
                onClick={() => pick(row)}
                className="workos-menu-row"
              >
                {row.icon && (
                  <span className="workos-menu-icon" aria-hidden="true">
                    {row.icon}
                  </span>
                )}
                <span className="workos-menu-name">{row.name}</span>
                <span className="workos-menu-desc">{row.desc}</span>
              </button>
            ))}
            {rows.length === 0 && (
              <div className="workos-menu-empty">No matches for &ldquo;{query}&rdquo;</div>
            )}
            <div className="workos-menu-foot">
              {menu === "at" ? "Type to filter Work OS context" : "Type to filter commands"}
            </div>
          </div>
        )}

        <div
          ref={gridRef}
          className={`workos-controls ${wide ? "wide" : "inline"}${footerLeft ? " has-footer" : ""}`}
        >
          <button
            type="button"
            className={`workos-plus ${plusOpen ? "open" : ""}`}
            aria-label={plusLabel}
            aria-expanded={plusOpen}
            onClick={() => {
              setDismissed(false);
              setPlusOpen((current) => !current);
              inputRef.current?.focus();
            }}
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
            onKeyDown={(event) => {
              if (menu && rows.length > 0) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setEngaged(true);
                  setActive(
                    (current) =>
                      (current + (event.key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length,
                  );
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
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className="workos-input"
          />

          {footerLeft && <span className="workos-footer-left">{footerLeft}</span>}

          <button
            type="button"
            className={`workos-send ${canSend && !busy ? "ready" : ""}`}
            aria-label={sendLabel}
            aria-keyshortcuts="Enter"
            disabled={!canSend || busy}
            onClick={send}
          >
            <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

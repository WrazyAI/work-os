import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Mic, Plus, Square, X } from "lucide-react";
import { FadeArc } from "../LoadingUi";
import { computeMenuPlacement } from "../menuPlacement";
import { GlideMenu, type GlideRow } from "./GlideMenu";
import {
  WORK_OS_CHAT_SOURCES,
  isWideDraft,
  parseChatToken,
  type WorkOsChatCommand,
  type WorkOsChatSource,
} from "./core";
import { formatRecordingClock, type VoiceInput } from "./voiceInput";

/** Bar weights for the live input meter: a real signal, never a decorative
 * loop, and only mounted while the microphone is open. */
const VOICE_METER_BARS = [0.45, 0.75, 1, 0.75, 0.45];

function VoiceMeter({ level }: { level: number }) {
  return (
    <span className="chat-voice-meter" aria-hidden="true">
      {VOICE_METER_BARS.map((weight, index) => (
        <span
          key={index}
          className="chat-voice-meter-bar"
          style={{ height: `${Math.max(3, Math.round(level * weight * 16))}px` }}
        />
      ))}
    </span>
  );
}

/**
 * The shared Work OS composer (design §7.2, §7.3): context (+), @ sources,
 * / commands, a growing field, an optional labeled footer action, and a dark
 * ink send. Parent owns the draft value, the send authority, and the voice
 * recorder; this owns menu/disclosure state so both delivery surfaces stay
 * identical.
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
  focusSignal = 0,
  voice,
  hotkeyLabel,
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
  /** Increment to focus the field (e.g. Edit on a chat recap card). */
  focusSignal?: number;
  /** Voice input. Absent or unsupported hides the record affordance. */
  voice?: VoiceInput;
  /** Human label for the hold-to-talk shortcut, e.g. "Ctrl + M". */
  hotkeyLabel?: string;
  className?: string;
}) {
  const menuId = useId();
  const [plusOpen, setPlusOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<CSSProperties | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const voiceState = voice?.state ?? "idle";
  const capturing = voiceState === "requesting" || voiceState === "recording";
  const transcribing = voiceState === "transcribing";
  const voiceMode = capturing || transcribing;
  /* The record affordance replaces the send only on an empty draft: the moment
     there is text to send, sending is the primary action again (and a second
     input method would compete with it). */
  const showRecord = !!voice && voice.supported && !voiceMode && !value.trim();

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

  /* Edit on a chat recap card hands editing here: focus the field when asked,
     with the caret at the end of any existing draft. */
  useEffect(() => {
    if (!focusSignal) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    try {
      input.setSelectionRange(input.value.length, input.value.length);
    } catch { /* caret placement is cosmetic */ }
  }, [focusSignal]);

  /* A settled transcript hands the caret back to the field, so the employee can
     review and correct it without reaching for the mouse. */
  const previousVoiceState = useRef(voiceState);
  useEffect(() => {
    if (previousVoiceState.current === "transcribing" && voiceState === "idle") inputRef.current?.focus();
    previousVoiceState.current = voiceState;
  }, [voiceState]);

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
      setMenuPlacement(null);
      return;
    }
    const update = () => {
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const next = { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width };
      setAnchor((current) => current && current.left === next.left && current.top === next.top && current.bottom === next.bottom && current.width === next.width ? current : next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [menu]);

  useLayoutEffect(() => {
    if (!menu || !anchor) return;
    const update = () => {
      const element = menuRef.current;
      if (!element) return;
      const width = Math.min(anchor.width, Math.max(0, window.innerWidth - 16));
      const placement = computeMenuPlacement({
        trigger: { top: anchor.top, bottom: anchor.bottom, left: anchor.left, right: anchor.left + anchor.width },
        menu: { width, height: element.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      const availableHeight = placement.placement === "up"
        ? anchor.top - 16
        : window.innerHeight - anchor.bottom - 16;
      setMenuPlacement({
        position: "fixed",
        top: placement.top,
        left: placement.left,
        width,
        maxHeight: Math.max(0, Math.min(264, availableHeight)),
        visibility: "visible",
        zIndex: 120,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, menu, rows.length]);

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


  /* Escape abandons a capture without transcribing it. The field is not
     mounted while recording, so the shortcut is owned here. */
  useEffect(() => {
    if (!voiceMode) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (capturing) voice?.cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [capturing, voice, voiceMode]);

  const wide = !voiceMode && isWideDraft(value, !!footerLeft);
  const hasFooter = !!footerLeft;
  const menuLabel = menu === "at" ? "Work OS context" : "Work OS commands";
  const activeOptionId = menu && rows[active] ? `${menuId}-option-${active}` : undefined;
  const gridColumns = wide && hasFooter
    ? "grid-cols-[36px_auto_minmax(0,1fr)_36px]"
    : hasFooter
      ? "grid-cols-[36px_minmax(0,1fr)_auto_36px]"
      : "grid-cols-[36px_minmax(0,1fr)_36px]";
  const voiceStatus = transcribing
    ? "Transcribing…"
    : voiceState === "requesting"
      ? "Waiting for the microphone…"
      : `${formatRecordingClock(voice?.elapsedMs ?? 0)} / ${formatRecordingClock(voice?.maxMs ?? 0)}`;

  return (
    <div ref={rootRef} data-workos-promptbar className={`relative w-full min-w-0 ${className ?? ""}`}>
      {menu && anchor && createPortal(
        <GlideMenu
          rows={rows}
          active={active}
          engaged={engaged}
          label={menuLabel}
          id={menuId}
          optionIdPrefix={`${menuId}-option`}
          menuRef={menuRef}
          className="overflow-y-auto rounded-[10px] border border-line bg-white p-1 shadow-raised"
          style={{
            position: "fixed",
            left: anchor.left,
            top: Math.max(8, anchor.top - 272),
            width: Math.min(anchor.width, Math.max(0, window.innerWidth - 16)),
            maxHeight: 264,
            visibility: "hidden",
            /* The in-app dock owns z-index 90; the detached menu must sit
               above that surface or its rows can look visible but lose clicks. */
            zIndex: 120,
            ...menuPlacement,
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
          wide ? "gap-2.5 rounded-[16px] p-3" : "gap-1.5 rounded-[16px] p-1.5"
        }`}
        data-sweep-signal={sweepSignal}
        data-voice-state={voiceState}
      >
        {sweepSignal > 0 ? <span key={sweepSignal} className="chat-composer-sweep" aria-hidden="true" /> : null}
        <span className="sr-only" role="status" aria-live="polite">
          {voiceState === "recording"
            ? "Recording your voice update"
            : voiceState === "transcribing"
              ? "Transcribing your recording"
              : voice?.receipt
                ? "Transcribed. Review the text before sending."
                : ""}
        </span>
        <div
          className={`relative z-10 grid items-end gap-x-1 gap-y-1.5 ${gridColumns}`}
        >
          {voiceMode ? (
            <>
              {/* The capture row keeps the composer's own grid, so the mode
                  change never moves the shell. Cancel is tertiary on the
                  left; stop is the primary action on the right. */}
              {capturing ? (
                <button
                  type="button"
                  aria-label="Cancel recording"
                  onClick={() => voice?.cancel()}
                  className="col-start-1 row-start-1 flex size-9 shrink-0 items-center justify-center justify-self-start rounded-[10px] text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
                >
                  <X size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              ) : (
                <span className="col-start-1 row-start-1 size-9" aria-hidden="true" />
              )}

              <span
                className="col-start-2 row-start-1 flex min-h-9 min-w-0 items-center gap-2 px-1 text-[11px] text-ink-2"
                data-voice-status
              >
                {capturing ? <VoiceMeter level={voice?.level ?? 0} /> : null}
                <span className={capturing ? "tabular-nums" : undefined}>{voiceStatus}</span>
                {capturing ? <span className="text-ink-3">Hold {hotkeyLabel ?? "Ctrl + M"} to talk</span> : null}
              </span>

              {capturing ? (
                <button
                  type="button"
                  aria-label="Stop recording"
                  onClick={() => voice?.stop()}
                  className="col-start-3 row-start-1 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-ink text-white transition-[background-color,color,transform] duration-200 active:scale-[0.96] hover:-translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <Square size={14} strokeWidth={2.4} fill="currentColor" aria-hidden="true" />
                </button>
              ) : (
                <span className="col-start-3 row-start-1 flex size-9 items-center justify-center text-ink-2" aria-hidden="true">
                  <FadeArc size={16} />
                </span>
              )}
            </>
          ) : (
            <>
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
                className={`flex size-9 shrink-0 items-center justify-center justify-self-start rounded-[10px] text-ink-2 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus ${
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
                role="combobox"
                aria-autocomplete="list"
                aria-haspopup="listbox"
                aria-expanded={Boolean(menu)}
                aria-controls={menuId}
                aria-activedescendant={activeOptionId}
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
                aria-label={showRecord ? (hotkeyLabel ? `Record a voice update (hold ${hotkeyLabel})` : "Record a voice update") : sendLabel}
                aria-keyshortcuts={showRecord && hotkeyLabel ? "Control+M" : "Enter"}
                disabled={showRecord ? false : (!canSend || busy)}
                onClick={showRecord ? () => voice?.start() : send}
                className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default ${
                  wide
                    ? hasFooter ? "col-start-4 row-start-2" : "col-start-3 row-start-2"
                    : hasFooter ? "col-start-4 row-start-1" : "col-start-3 row-start-1"
                } ${
                  showRecord
                    ? "bg-line text-ink-2 hover:bg-hover-2 hover:text-ink"
                    : canSend && !busy ? "bg-ink text-white hover:-translate-y-px" : "bg-line text-ink-2"
                }`}
              >
                {showRecord
                  ? <Mic size={16} strokeWidth={2.2} aria-hidden="true" />
                  : <ArrowUp size={16} strokeWidth={2.4} aria-hidden="true" />}
              </button>
            </>
          )}
        </div>
      </div>

      {voice?.error ? (
        <p role="status" className="chat-voice-note" data-voice-error>
          <span>{voice.error}</span>
          <button type="button" onClick={() => voice.dismissError()} aria-label="Dismiss voice input message">Dismiss</button>
        </p>
      ) : voice?.receipt ? (
        <p role="status" className="chat-voice-note is-receipt" data-voice-receipt>Transcribed — review it, then send.</p>
      ) : null}
    </div>
  );
}

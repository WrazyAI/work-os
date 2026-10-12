import { createElement, type ReactNode } from "react";
import {
  CalendarDays,
  ListChecks,
  MessageSquareText,
  Pencil,
  ShieldCheck,
  Video,
} from "lucide-react";

/* ─────────────────────────────────────────────────────────
 * Work OS chat core — pure types and catalogs shared by the
 * dock composer and the floating companion (design §25.11).
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
  /** Text inserted when picked (defaults to `@name `). */
  insert?: string;
}

/** Work OS data the assistant can already see — mentioning it only
 *  names the context in plain text; nothing is fetched or attached. */
export const WORK_OS_CHAT_SOURCES: WorkOsChatSource[] = [
  { key: "loom", name: "Loom link", desc: "Paste a recording link to analyze it", insert: "Loom: ", icon: createElement(Video, { size: 15, "aria-hidden": true }) },
  { key: "tasks", name: "Today's tasks", desc: "Titles, status, and due dates", icon: createElement(ListChecks, { size: 15, "aria-hidden": true }) },
  { key: "focus", name: "Today's focus", desc: "The current goal note", icon: createElement(Pencil, { size: 15, "aria-hidden": true }) },
  { key: "eod", name: "EOD review", desc: "Draft and submission state", icon: createElement(MessageSquareText, { size: 15, "aria-hidden": true }) },
  { key: "evidence", name: "Evidence", desc: "Provenance and timestamps", icon: createElement(ShieldCheck, { size: 15, "aria-hidden": true }) },
  { key: "day", name: "Day summary", desc: "Shift, session, and counts", icon: createElement(CalendarDays, { size: 15, "aria-hidden": true }) },
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

/** Two-row composer layout for drafts that actually need more room. The
 *  labeled Focus action stays in the compact row while the field is empty or
 *  single-line, then moves below a draft that can grow. Deliberately derived
 *  from the draft value only — measuring the field feeds back into the next
 *  measurement and oscillates as placeholder wrap changes with width. */
export function isWideDraft(value: string, hasFooter: boolean): boolean {
  return value.includes("\n") || (hasFooter && value.trim().length > 0);
}

export interface CollapsibleTurn {
  role: string;
  text: string;
  operations?: unknown;
  toolResults?: unknown;
  /** The recap next-steps moment a turn carries. Two moments share the same
   * lead sentence but are different cards, so the signature must include it. */
  nextSteps?: unknown;
}

/** Stable serialization for JSON-shaped chat payloads. Object keys do not
 * carry identity, but array order does: two task views with the same titles
 * can still be different views when their result payloads differ. */
function stableValueSignature(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(stableValueSignature).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValueSignature(record[key])}`).join(",")}}`;
  }
  return String(value);
}

/** Stable identity of the cards a turn rendered. Include the full JSON-shaped
 * payload so different task lists are never collapsed as duplicate prose — and
 * the next-steps moment, because two moments share the same lead sentence but
 * are different cards (a newer moment must never vanish behind an older one). */
function cardSignature(turn: CollapsibleTurn): string {
  return `${stableValueSignature(turn.operations ?? [])}::${stableValueSignature(turn.toolResults ?? [])}::${stableValueSignature(turn.nextSteps ?? null)}`;
}

/** Collapse consecutive duplicate assistant turns at render. Dupes reach the
 * thread through double-saves and history/live-echo overlap; hiding later
 * repeats heals them without rewriting persisted data. A repeat only collapses
 * when its cards match too, so two genuinely different reviews that happen to
 * share a reply sentence both stay visible. */
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
      cardSignature(prev) === cardSignature(turn)
    ) {
      continue;
    }
    visible.push(turn);
  }
  return visible;
}

/* ─────────────────────────────────────────────────────────
 * Thread reveal — where a scroller should land when content
 * arrives. A tall reply (a task card) must reveal its first
 * lines at the bottom edge instead of dumping the reader at
 * its end, and a reader who scrolled up is never yanked.
 * ───────────────────────────────────────────────────────── */

export interface ThreadScrollInput {
  clientHeight: number;
  scrollTop: number;
  scrollHeight: number;
  /** Height of the newest turn, or 0 when the thread ends in the history block. */
  newestHeight: number;
  /** The newest turn's top relative to the scroller's visible top
   *  (`newest.getBoundingClientRect().top - scroller.getBoundingClientRect().top`). */
  newestTop: number;
  /** Whether the reader was at the end of the thread before this arrival. */
  wasAtBottom: boolean;
  /** Always land at the end (e.g. the dock just opened). */
  forceBottom?: boolean;
  /** How much of a tall turn stays visible at the bottom edge. */
  revealPx?: number;
}

export function isThreadNearBottom(input: Pick<ThreadScrollInput, "clientHeight" | "scrollTop" | "scrollHeight"> & { thresholdPx?: number }): boolean {
  return input.scrollHeight - input.scrollTop - input.clientHeight < (input.thresholdPx ?? 48);
}

/** Returns the scrollTop to apply, or null to leave the reader where they are. */
export function threadScrollTarget(input: ThreadScrollInput): number | null {
  const max = Math.max(0, input.scrollHeight - input.clientHeight);
  if (input.forceBottom) return max;
  if (!input.wasAtBottom) return null;
  const reveal = input.revealPx ?? 96;
  if (input.newestHeight > input.clientHeight - reveal) {
    return Math.max(0, Math.min(input.scrollTop + input.newestTop - (input.clientHeight - reveal), max));
  }
  return max;
}

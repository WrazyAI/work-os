/**
 * Bounded persistence for an Admin Otto conversational turn.
 *
 * The reply itself comes from the model-backed interpreter. This module owns
 * only the opaque source reference stored beside that turn, so replay and
 * rehydration return the exact saved text without a second model call.
 */

export type AdminOttoMessageRef = { v: 1; kind: "message"; text: string };

const MAX_MESSAGE_LENGTH = 2_000;
const MESSAGE_KEYS = ["v", "kind", "text"] as const;

/** Build the persisted opaque ref for a message-only turn. */
export function adminOttoMessageRef(text: string): AdminOttoMessageRef {
  const value = text.trim();
  if (!value || value.length > MAX_MESSAGE_LENGTH) {
    throw new Error("Admin Otto conversational reply is outside the stored-message bound");
  }
  return { v: 1, kind: "message", text: value };
}

/** Rehydrate a stored message ref. Unknown versions/kinds, extra fields and
 * oversized text are refused rather than trusted. */
export function readAdminOttoMessageRef(value: unknown): AdminOttoMessageRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== MESSAGE_KEYS.length || !MESSAGE_KEYS.every((key) => key in row)) return null;
  if (row.v !== 1 || row.kind !== "message") return null;
  if (typeof row.text !== "string") return null;
  const text = row.text.trim();
  if (!text || text !== row.text || text.length > MAX_MESSAGE_LENGTH) return null;
  return { v: 1, kind: "message", text };
}

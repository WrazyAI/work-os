import type { ProfileItemKind, WorkProfileItem } from "./types";

/** Work-profile items are picked from the selected scope's own suggestions, so
 * these helpers own the one contract every pill group shares: a catalog pick
 * keeps its catalog id and "suggested" source, your own addition becomes a
 * bounded "user" item, and a label is never kept twice within its kind. The
 * same rules bound what `normalizeProfileItems` accepts on the server. */

export const PROFILE_ITEM_LIMIT = 90;
export const PROFILE_ITEM_LABEL_LIMIT = 120;

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "custom";

const labelKey = (label: string) => label.trim().toLowerCase();

export function profileItemsOfKind(items: WorkProfileItem[], kind: ProfileItemKind): WorkProfileItem[] {
  return items.filter((item) => item.kind === kind);
}

/** The scope suggestions a group can still offer: same kind, not picked yet. */
export function suggestedProfileItems(items: WorkProfileItem[], options: WorkProfileItem[], kind: ProfileItemKind): WorkProfileItem[] {
  const picked = new Set(profileItemsOfKind(items, kind).map((item) => labelKey(item.label)));
  return options.filter((item) => item.kind === kind && !picked.has(labelKey(item.label)));
}

export function addProfileItem(items: WorkProfileItem[], item: WorkProfileItem): WorkProfileItem[] {
  const label = item.label.trim().slice(0, PROFILE_ITEM_LABEL_LIMIT);
  if (!label) return items;
  if (items.some((entry) => entry.kind === item.kind && labelKey(entry.label) === labelKey(label))) return items;
  if (items.length >= PROFILE_ITEM_LIMIT) return items;
  return [...items, { ...item, label }];
}

export function removeProfileItem(items: WorkProfileItem[], id: string): WorkProfileItem[] {
  return items.filter((item) => item.id !== id);
}

/** Your own addition: bounded label, deterministic id, user-owned source. */
export function customProfileItem(kind: ProfileItemKind, label: string): WorkProfileItem | null {
  const trimmed = label.trim().slice(0, PROFILE_ITEM_LABEL_LIMIT);
  if (!trimmed) return null;
  return { id: `custom:${kind}:${slug(trimmed)}`, kind, label: trimmed, source: "user" };
}

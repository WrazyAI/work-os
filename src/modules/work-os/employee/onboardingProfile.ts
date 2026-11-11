import { normalizeProfileItems, type ProfileItemKind, type WorkProfileItem } from "../onboarding";

/** The three peer work-profile groups the onboarding form and the companion
 * both use. The web form renders them as one compact picker so a new employee
 * can finish setup without the desktop app. */
export const PROFILE_KINDS: Array<{ kind: ProfileItemKind; label: string; hint: string }> = [
  { kind: "responsibility", label: "Responsibilities", hint: "What you own or decide." },
  { kind: "deliverable", label: "Outputs", hint: "What you produce." },
  { kind: "evidence", label: "Evidence sources", hint: "Where your work is recorded." },
];

export interface WorkPreferencesInput {
  archetypeId: string;
  specialtyIds: string[];
  customRoleTitle: string;
  items: WorkProfileItem[];
  voiceUpdatesEnabled?: boolean;
  githubUsername?: string;
}

export interface WorkPreferencesPayload {
  archetypeId: string;
  specialtyIds: string[];
  customRoleTitle: string;
  items: WorkProfileItem[];
  responsibilities: string[];
  outputTypes: string[];
  evidenceSources: string[];
  voiceUpdatesEnabled: boolean;
  githubUsername: string;
}

/** The one local rule the server enforces at submit time: a work profile needs
 * at least one concrete signal, and a custom role needs its name. */
export function profileSetupIssue(input: {
  archetypeId: string;
  customRoleTitle: string;
  items: WorkProfileItem[];
}): string | null {
  if (!normalizeProfileItems(input.items).length) return "Choose at least one responsibility, output, or evidence source.";
  if (input.archetypeId === "custom" && !input.customRoleTitle.trim()) return "Describe your role.";
  return null;
}

export function buildWorkPreferences(input: WorkPreferencesInput): WorkPreferencesPayload {
  const items = normalizeProfileItems(input.items);
  return {
    archetypeId: input.archetypeId,
    specialtyIds: [...new Set(input.specialtyIds)].slice(0, 12),
    customRoleTitle: input.archetypeId === "custom" ? input.customRoleTitle.trim().slice(0, 120) : "",
    items,
    responsibilities: items.filter((item) => item.kind === "responsibility").map((item) => item.label),
    outputTypes: items.filter((item) => item.kind === "deliverable").map((item) => item.label),
    evidenceSources: items.filter((item) => item.kind === "evidence").map((item) => item.label),
    voiceUpdatesEnabled: input.voiceUpdatesEnabled === true,
    githubUsername: (input.githubUsername ?? "").trim().slice(0, 120),
  };
}

export function userProfileItem(kind: ProfileItemKind, label: string): WorkProfileItem {
  const clean = label.trim().slice(0, 120);
  return {
    id: `user:${kind}:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
    kind,
    label: clean,
    source: "user",
  };
}

export function addProfileItem(items: WorkProfileItem[], item: WorkProfileItem): WorkProfileItem[] {
  const label = item.label.trim().toLowerCase();
  if (!label) return items;
  if (items.some((current) => current.kind === item.kind && current.label.trim().toLowerCase() === label)) return items;
  return [...items, item];
}

export function removeProfileItem(items: WorkProfileItem[], id: string): WorkProfileItem[] {
  return items.filter((item) => item.id !== id);
}

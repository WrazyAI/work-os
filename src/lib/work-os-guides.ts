import { createAdminClient } from "@/lib/supabase/admin";
import { WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";

/**
 * First-visit page guides.
 *
 * Flags live on the member row (`work_org_members.ui_state`) so they follow the
 * account across devices and stay out of feature entitlements and onboarding
 * consent. The server owns the key allowlist; a client that ships ahead of the
 * server can only mark keys this list knows, and reads normalize whatever the
 * row holds back into this shape. The five employee pages and the seven
 * administration sections carry separate keys, so dismissing one surface's
 * guide never consumes the other's. Keys stay lowercase with underscores
 * because the member-state RPC validates that shape.
 */
export const WORK_OS_GUIDE_KEYS = [
  "day",
  "tasks",
  "review",
  "insights",
  "settings",
  "admin_overview",
  "admin_people",
  "admin_tasks",
  "admin_review",
  "admin_insights",
  "admin_evidence",
  "admin_settings",
] as const;
export type WorkOsGuideKey = (typeof WORK_OS_GUIDE_KEYS)[number];

export interface WorkOsGuideState {
  guides: Partial<Record<WorkOsGuideKey, string>>;
  autoOpen: boolean;
}

const GUIDE_KEY_SET = new Set<string>(WORK_OS_GUIDE_KEYS);

export function isWorkOsGuideKey(value: unknown): value is WorkOsGuideKey {
  return typeof value === "string" && GUIDE_KEY_SET.has(value);
}

/** Unknown keys, malformed values, and non-object rows are dropped; a missing
 * `autoOpen` means the historical default (on). */
export function normalizeWorkOsGuideState(raw: unknown): WorkOsGuideState {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const stored = row.guides && typeof row.guides === "object" && !Array.isArray(row.guides)
    ? (row.guides as Record<string, unknown>)
    : {};
  const guides: Partial<Record<WorkOsGuideKey, string>> = {};
  for (const key of WORK_OS_GUIDE_KEYS) {
    const value = stored[key];
    if (typeof value === "string" && value.trim()) guides[key] = value;
  }
  return { guides, autoOpen: row.autoOpen !== false };
}

export async function loadWorkOsGuideState(access: WorkOsAccess): Promise<WorkOsGuideState> {
  const { data, error } = await createAdminClient()
    .from("work_org_members")
    .select("ui_state")
    .eq("id", access.membershipId)
    .maybeSingle();
  if (error) throw new Error(`load Work OS guide state: ${error.message}`);
  return normalizeWorkOsGuideState(data?.ui_state);
}

export async function markWorkOsGuideSeen(access: WorkOsAccess, guide: unknown): Promise<WorkOsGuideState> {
  if (!isWorkOsGuideKey(guide)) throw new WorkOsValidationError("A known guide key is required.");
  const { data, error } = await createAdminClient().rpc("work_mark_guide_seen", {
    p_membership_id: access.membershipId,
    p_guide: guide,
  });
  if (error) throw new Error(`mark Work OS guide seen: ${error.message}`);
  return normalizeWorkOsGuideState(data);
}

export async function setWorkOsGuideAutoOpen(access: WorkOsAccess, enabled: unknown): Promise<WorkOsGuideState> {
  if (typeof enabled !== "boolean") throw new WorkOsValidationError("A guide auto-open preference is required.");
  const { data, error } = await createAdminClient().rpc("work_set_guide_auto_open", {
    p_membership_id: access.membershipId,
    p_enabled: enabled,
  });
  if (error) throw new Error(`save Work OS guide preference: ${error.message}`);
  return normalizeWorkOsGuideState(data);
}

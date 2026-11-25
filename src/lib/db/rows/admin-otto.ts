import type { AdminOttoPendingAction, AdminOttoPlanStep } from "@wrazy/work-os-shared/admin-otto/contracts";
import type { PgTimestamp } from "@/lib/db/rows/payroll";

/**
 * Database row contracts for Admin Otto tables (`supabase/migrations/0065`
 * and companion workflow/fence extensions).
 */

export interface WorkDesktopSessionScopeRow {
  organization_id: string;
}

export interface WorkOrgMemberScopeRow {
  id: string;
  organization_id: string;
  role: string;
  person_id: string | null;
  feature_flags: Record<string, unknown> | null;
  created_at: PgTimestamp;
}

export interface WorkAdminOttoThreadRow {
  id: string;
  organization_id: string;
  membership_id: string;
  context_version: number;
  last_intent: Record<string, unknown> | null;
  resolved_person_ids: string[];
  pending_resolution: Record<string, unknown> | null;
  created_at: PgTimestamp;
  updated_at: PgTimestamp;
}

export interface WorkAdminOttoTurnRow {
  id: string;
  thread_id?: string;
  organization_id?: string;
  membership_id?: string;
  request_id?: string;
  role: "user" | "assistant";
  text: string;
  source_refs: Record<string, unknown> | null;
  created_at: PgTimestamp;
}

export interface WorkAdminOttoChatRequestRow {
  organization_id: string;
  membership_id: string;
  user_id: string;
  request_id: string;
  request_hash: string;
  requested_conversation_id: string | null;
  thread_id: string;
  turn_id: string;
  created_at: PgTimestamp;
}

export interface WorkAdminOttoRequestFenceRow {
  abandoned: boolean;
}

export interface WorkAdminOttoWorkflowProgressEntry {
  action?: AdminOttoPendingAction;
  refs?: unknown;
  message: string;
  failed?: boolean;
  revision?: number;
}

export interface WorkAdminOttoWorkflowRow {
  id: string;
  request_hash: string;
  plan: AdminOttoPlanStep[];
  progress: Record<string, WorkAdminOttoWorkflowProgressEntry>;
  abandoned_at: PgTimestamp | null;
}

export interface WorkAdminOttoPreferenceRow {
  organization_id: string;
  membership_id: string;
  mode: "all" | "selected";
  selected_person_ids: string[];
  revision: number;
  access_epoch: number;
  activated_sequence: string | number | null;
  materialized_through_sequence: string | number;
  active: boolean;
  created_at: PgTimestamp;
  updated_at: PgTimestamp;
}

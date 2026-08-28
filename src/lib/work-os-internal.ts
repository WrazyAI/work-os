import { createAdminClient } from "@/lib/supabase/admin";
import { withNiftyOrganization } from "@/lib/integrations/nifty";
import type { WorkOsAccess } from "@/lib/work-os-api";
import {
  localDateForTimezone,
  type WorkOsScheduleException,
  type WorkOsScheduleRule,
} from "@/modules/work-os/companion";

export type Json = Record<string, unknown>;
export type Db = ReturnType<typeof createAdminClient>;

export class WorkOsMigrationRequiredError extends Error {
  constructor(message = "Work OS database tables are not installed. Run npm run db:apply:work-os, then retry.") {
    super(message);
    this.name = "WorkOsMigrationRequiredError";
  }
}

export function isWorkOsMigrationRequired(err: unknown) {
  return err instanceof WorkOsMigrationRequiredError;
}

function missingWorkOsSchema(message: string) {
  return (
    /relation "work_[^"]+" does not exist/i.test(message) ||
    /Could not find the table 'public\.work_/i.test(message) ||
    /schema cache/i.test(message) && /work_/i.test(message)
  );
}

export function db() {
  return createAdminClient();
}

export async function niftyForOwner<T>(userId: string, operation: () => Promise<T>) {
  const { data, error } = await db().from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle();
  if (error) throw new Error(`load Nifty organization scope: ${error.message}`);
  if (!data) throw new Error("Work OS organization is required before accessing Nifty");
  return withNiftyOrganization(data.id, operation);
}

export function dateOnly(value?: string | null) {
  if (!value) return null;
  const m = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

export function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function section(description: string | null | undefined, heading: string) {
  if (!description) return null;
  const match = description.match(new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"));
  return match?.[1]?.trim() || null;
}

export async function ensureNoError<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>, label: string): Promise<T> {
  const { data, error } = await query;
  if (error) {
    if (missingWorkOsSchema(error.message)) throw new WorkOsMigrationRequiredError();
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

export async function selectFirst<T = Json>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string): Promise<T> {
  const rows = await ensureNoError(query, label);
  if (!rows?.[0]) throw new Error(`${label}: no row returned`);
  return rows[0];
}

export function niftyIdentity(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of ["id", "_id", "user_id", "member_id"]) if (typeof row[key] === "string" && row[key]) return row[key] as string;
  return null;
}

export type ProposalOperation =
  | "create_task"
  | "update_task"
  | "log_progress"
  | "add_blocker"
  | "resolve_blocker"
  | "link_evidence"
  | "complete_task"
  | "remove_from_plan";

export const OPERATIONS = new Set<ProposalOperation>([
  "create_task",
  "update_task",
  "log_progress",
  "add_blocker",
  "resolve_blocker",
  "link_evidence",
  "complete_task",
  "remove_from_plan",
]);

export async function organizationOwnerId(organizationId: string) {
  const { data, error } = await db()
    .from("work_organizations")
    .select("legacy_owner_id, created_by")
    .eq("id", organizationId)
    .single();
  if (error) throw new Error(`load Work OS organization: ${error.message}`);
  const ownerId = data.legacy_owner_id || data.created_by;
  if (!ownerId) throw new Error("Work OS organization has no Nifty provider owner");
  return ownerId as string;
}

export async function audit(access: WorkOsAccess, action: string, targetType: string, targetId?: string | null, metadata: Json = {}) {
  const { error } = await db().from("work_audit_log").insert({
    organization_id: access.organizationId,
    actor_user_id: access.ctx.user.id,
    action,
    target_type: targetType,
    target_id: targetId ?? null,
    metadata,
  });
  if (error) throw new Error(`write Work OS audit log: ${error.message}`);
}

export async function loadShiftData(access: WorkOsAccess, personId: string, at: Date) {
  const { data: schedules, error: scheduleError } = await db()
    .from("work_schedules")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .eq("active", true)
    .order("effective_from", { ascending: false });
  if (scheduleError) throw new Error(`load shift schedules: ${scheduleError.message}`);
  const rules = (schedules ?? []) as WorkOsScheduleRule[];
  const timezone = rules[0]?.timezone ?? "UTC";
  const localDate = localDateForTimezone(at, timezone);
  const from = new Date(`${localDate}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(`${localDate}T12:00:00Z`);
  to.setUTCDate(to.getUTCDate() + 1);
  const { data: exceptions, error: exceptionError } = await db()
    .from("work_schedule_exceptions")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .gte("exception_date", from.toISOString().slice(0, 10))
    .lte("exception_date", to.toISOString().slice(0, 10));
  if (exceptionError) throw new Error(`load shift exceptions: ${exceptionError.message}`);
  return { rules, exceptions: (exceptions ?? []) as WorkOsScheduleException[], timezone };
}

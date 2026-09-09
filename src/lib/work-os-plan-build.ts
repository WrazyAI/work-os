import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkOsAccess } from "@/lib/work-os-api";

const BUILD_TTL_MS = 10 * 60_000;

function normalizedIntent(input: unknown) {
  return typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
}

/** A stable server-side fingerprint lets Neon bind a build without storing intent text. */
export function planIntentFingerprint(input: unknown) {
  const intent = normalizedIntent(input);
  if (!intent) throw new Error("A plan intent is required for AI build confirmation.");
  return createHash("sha256").update(intent, "utf8").digest("hex");
}

export async function issueDailyPlanBuild(access: WorkOsAccess, shiftDate: string, rawIntent: unknown) {
  const now = new Date();
  const id = randomUUID();
  const { error } = await createAdminClient().from("work_daily_plan_builds").insert({
    id,
    organization_id: access.organizationId,
    person_id: access.personId,
    shift_date: shiftDate,
    intent_fingerprint: planIntentFingerprint(rawIntent),
    expires_at: new Date(now.getTime() + BUILD_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`issue AI plan build: ${error.message}`);
  return id;
}

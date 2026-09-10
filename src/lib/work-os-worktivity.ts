import { employeeName, wtPost, worktivityConfigured, type WtEmployee, type WtPaged } from "@/lib/worktivity";
import { fetchAppsSummary } from "@/lib/worktivityAudit";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import { todayIso as today } from "@/lib/work-os-dates";
import { db, ensureNoError, selectFirst } from "@/lib/work-os-internal";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!/429|rate limit/i.test(message)) break;
      await wait(1_200 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}

export async function upsertWorktivityEmployee(userId: string, employee: WtEmployee) {
  const supabase = db();
  const email = employee.Invitation?.Email?.trim() || null;
  if (email) {
    const existing = await ensureNoError(
      supabase
        .from("work_people")
        .select("*")
        .eq("user_id", userId)
        .ilike("email", email)
        .maybeSingle(),
      "find existing Worktivity employee by email",
    );
    if (existing) {
      return selectFirst(
        supabase.from("work_people").update({
          display_name: existing.display_name || employeeName(employee),
          email,
          worktivity_employee_id: employee.ID,
          worktivity_user_id: employee.UserId,
          raw: { ...(existing.raw ?? {}), worktivity: employee },
          active: existing.active === true || (employee.IsActive && !employee.Blocked),
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id).select("*"),
        "merge Worktivity employee by email",
      );
    }
  }

  return selectFirst(
    supabase.from("work_people").upsert({
      user_id: userId,
      display_name: employeeName(employee),
      email,
      worktivity_employee_id: employee.ID,
      worktivity_user_id: employee.UserId,
      raw: { worktivity: employee },
      active: employee.IsActive && !employee.Blocked,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,worktivity_employee_id" }).select("*"),
    "upsert Worktivity employee",
  );
}

export async function syncWorktivityRoster(userId: string) {
  if (!worktivityConfigured()) return { employees: 0, skipped: true };
  const data = await wtPost<WtPaged<WtEmployee>>("/Employee/List", { page: 1, pageSize: 200 });
  const employees = data.Items ?? [];
  for (const employee of employees) await upsertWorktivityEmployee(userId, employee);
  return { employees: employees.length, skipped: false };
}

export async function syncWorktivityEvidence(userId: string, date = today(), personId?: string) {
  if (!worktivityConfigured()) return { evidence: 0, skipped: true };
  const supabase = db();
  let peopleQuery = supabase
    .from("work_people")
    .select("id, organization_id, display_name, worktivity_employee_id")
    .eq("user_id", userId)
    .not("worktivity_employee_id", "is", null);
  if (personId) peopleQuery = peopleQuery.eq("id", personId);
  const people = await ensureNoError(peopleQuery, "load Worktivity mapped people");
  let count = 0;
  let skippedWithoutConsent = 0;
  for (const person of people ?? []) {
    const personRow = person as { id: string; organization_id: string | null; display_name: string };
    if (!personRow.organization_id) throw new Error("Work OS person has no organization mapping");
    const consent = await employeeTrackingConsent(personRow.organization_id, personRow.id);
    if (!consent.tracking) {
      skippedWithoutConsent += 1;
      continue;
    }
    const employeeId = (person as { worktivity_employee_id: string }).worktivity_employee_id;
    await wait(250);
    const apps = await withRateLimitRetry(
      () => fetchAppsSummary({ employeeId, start: date, end: date }),
      "sync Worktivity evidence",
    );
    const totalMinutes = apps.reduce((sum, app) => sum + app.minutes, 0);
    const categories = new Map<string, number>();
    for (const app of apps) categories.set(app.category || "Other", (categories.get(app.category || "Other") ?? 0) + app.minutes);
    const event = await selectFirst(
      supabase.from("work_evidence_events").upsert({
        organization_id: personRow.organization_id,
        provider: "worktivity",
        external_event_id: `activity:${employeeId}:${date}`,
        person_id: personRow.id,
        evidence_class: "activity_observation",
        title: `Worktivity activity: ${personRow.display_name}`,
        summary: `${Math.round(totalMinutes)} tracked minutes across ${apps.length} apps/sites.`,
        attribution_method: "merged_worktivity_person",
        attribution_confidence: 1,
        occurred_at: `${date}T12:00:00Z`,
        metadata: { totalMinutes, categories: [...categories.entries()] },
        raw: { apps },
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,provider,external_event_id" }).select("*"),
      "upsert Worktivity activity event",
    );
    const evidenceFields = {
      user_id: userId,
      organization_id: personRow.organization_id,
      person_id: personRow.id,
      evidence_event_id: event.id,
      evidence_date: date,
      source: "worktivity",
      title: `Worktivity activity: ${(person as { display_name: string }).display_name}`,
      summary: `${Math.round(totalMinutes)} tracked minutes across ${apps.length} apps/sites.`,
      metrics: {
        totalMinutes,
        topApps: apps.slice(0, 10),
        categories: [...categories.entries()].map(([category, minutes]) => ({ category, minutes })),
      },
      raw: { apps },
      updated_at: new Date().toISOString(),
    };
    // The uniqueness guarantee on evidence_event_id is a partial index, which
    // ON CONFLICT cannot target through the query shim. Select, then update.
    const existingEvidence = await ensureNoError(
      supabase.from("work_evidence").select("id").eq("evidence_event_id", event.id).maybeSingle(),
      "load existing Worktivity evidence",
    );
    await ensureNoError(
      existingEvidence?.id
        ? supabase.from("work_evidence").update(evidenceFields).eq("id", existingEvidence.id)
        : supabase.from("work_evidence").insert(evidenceFields),
      existingEvidence?.id ? "update Worktivity evidence" : "insert Worktivity evidence",
    );
    count += 1;
  }
  return { evidence: count, skipped: false, skippedWithoutConsent };
}

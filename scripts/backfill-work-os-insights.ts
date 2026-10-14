#!/usr/bin/env node
// Historical, authentic backfill for Work OS insights data.
//
//   npx tsx scripts/backfill-work-os-insights.ts --person employee@example.com --from 2026-08-01 --to 2026-09-10
//
// What it repairs, all from provider-exact data (nothing is fabricated):
//   sessions  — missing/open sessions from stored Worktivity observations, or
//               the provider's own activity logs for days before observations
//   evidence  — Worktivity AppsSummary activity evidence per day
//   events    — task completed/creation day events derived from mirror
//               timestamps when the event ledger is missing them
//
// Idempotent: transition keys, evidence upserts, and day-event idempotency keys
// make repeated runs safe. Use --dry-run to count without writing.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    const target = path.resolve(process.cwd(), file);
    if (!existsSync(target)) continue;
    for (const line of readFileSync(target, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) continue;
      if (process.env[match[1]]) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }
}
loadEnv();

function args() {
  const out: Record<string, string | boolean> = {};
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else { out[key] = next; index += 1; }
  }
  return out;
}

function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

async function main() {
  const { db } = await import("../src/lib/work-os-internal");
  const { reconcileWorktivitySessionForDate, closeStaleWorktivitySessions } = await import("../src/lib/work-os-attendance");
  const { syncWorktivityEvidence } = await import("../src/lib/work-os-worktivity");
  const { recordTaskDayEvent } = await import("../src/lib/work-os-daily-workspace");
  const { niftyTaskEventIdempotencyKey } = await import("../src/lib/work-os-nifty");
  const { isNiftyTaskAttributableToMember } = await import("../src/lib/work-os-tasks");
  const { localDateForTimezone } = await import("../src/modules/work-os/companion");
  const options = args();
  const email = typeof options.person === "string" ? options.person : "employee@example.com";
  const from = typeof options.from === "string" ? options.from : "2026-08-01";
  const to = typeof options.to === "string" ? options.to : new Date().toISOString().slice(0, 10);
  const dryRun = options["dry-run"] === true;
  const anyExplicit = options.sessions === true || options.evidence === true || options.events === true;
  const doSessions = !anyExplicit || options.sessions === true;
  const doEvidence = !anyExplicit || options.evidence === true;
  const doEvents = !anyExplicit || options.events === true;

  const { data: person, error: personError } = await db().from("work_people")
    .select("id,organization_id,nifty_member_id,worktivity_employee_id,display_name")
    .eq("email", email).not("worktivity_employee_id", "is", null).limit(1).maybeSingle();
  if (personError) throw new Error(`load backfill person: ${personError.message}`);
  if (!person) throw new Error(`no Worktivity-mapped person for ${email}`);
  const { data: organization, error: organizationError } = await db().from("work_organizations")
    .select("id,legacy_owner_id,created_by").eq("id", person.organization_id).single();
  if (organizationError) throw new Error(`load backfill organization: ${organizationError.message}`);
  const ownerId = organization.legacy_owner_id || organization.created_by;
  const { data: onboarding } = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", person.organization_id).eq("person_id", person.id).maybeSingle();
  const timezone = typeof onboarding?.timezone === "string" && onboarding.timezone.trim() ? onboarding.timezone : "UTC";

  const access = {
    ctx: { user: { id: ownerId }, profile: { id: ownerId } },
    organizationId: person.organization_id,
    organizationOwnerId: ownerId,
    role: "admin",
    personId: person.id,
    membershipId: `backfill-insights:${person.id}`,
    featureFlags: {},
  } as never;

  const today = localDateForTimezone(new Date(), timezone);
  const dates = eachDate(from, to);
  console.log("BACKFILL", JSON.stringify({ person: email, personId: person.id, from, to, timezone, today, dryRun, doSessions, doEvidence, doEvents }));

  if (!dryRun && doSessions) {
    const stale = await closeStaleWorktivitySessions(access);
    console.log("STALE_SESSIONS_CLOSED", stale.closed);
  }

  const sessionStatuses: Record<string, number> = {};
  const evidenceCounts: number[] = [];
  let eventsCreated = 0;

  const tasks = doEvents
    ? ((await db().from("work_tasks").select("*").eq("organization_id", person.organization_id).eq("user_id", ownerId)).data ?? [])
    : [];
  const attributed = tasks.filter((task: Record<string, unknown>) =>
    (Array.isArray(task.assignee_person_ids) && task.assignee_person_ids.includes(person.id))
    || isNiftyTaskAttributableToMember(task, person.nifty_member_id));

  for (const date of dates) {
    if (doSessions && date < today) {
      if (dryRun) {
        sessionStatuses.dry = (sessionStatuses.dry ?? 0) + 1;
      } else {
        const result = await reconcileWorktivitySessionForDate(access, date);
        sessionStatuses[result.status] = (sessionStatuses[result.status] ?? 0) + 1;
      }
    }
    if (doEvidence) {
      if (dryRun) evidenceCounts.push(date < today ? 1 : 0);
      else {
        const result = await syncWorktivityEvidence(ownerId, date, person.id);
        evidenceCounts.push(Number(result.evidence ?? 0));
      }
    }
    if (doEvents) {
      for (const task of attributed as Array<Record<string, unknown>>) {
        const completedAt = isoTimestamp(task.completed_at);
        const createdAt = isoTimestamp(task.provider_created_at);
        const providerTaskId = typeof task.provider_task_id === "string" ? task.provider_task_id : null;
        if (!providerTaskId) continue;
        if (completedAt && task.completed === true && localDateForTimezone(new Date(completedAt), timezone) === date) {
          if (dryRun) eventsCreated += 1;
          else {
            await recordTaskDayEvent(access, task, "completed", { idempotencyKey: niftyTaskEventIdempotencyKey("completed", providerTaskId, completedAt), exactAt: completedAt, provenance: "nifty_exact" });
            eventsCreated += 1;
          }
        }
        if (createdAt && localDateForTimezone(new Date(createdAt), timezone) === date) {
          if (dryRun) eventsCreated += 1;
          else {
            await recordTaskDayEvent(access, task, "creation_observed", { idempotencyKey: niftyTaskEventIdempotencyKey("created", providerTaskId, createdAt), exactAt: createdAt, provenance: "provider_observed" });
            eventsCreated += 1;
          }
        }
      }
    }
  }

  console.log("SESSIONS", JSON.stringify(sessionStatuses));
  console.log("EVIDENCE_DAYS_WITH_DATA", evidenceCounts.filter((count) => count > 0).length, "of", dates.length);
  console.log("EVENTS_RECORDED", eventsCreated);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error("BACKFILL_FAILED", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);

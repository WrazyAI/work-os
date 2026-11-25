/**
 * Seed the default Insights exclusions for one organization.
 *
 * The schema migration adds the flag; this one-off script names the specific
 * test/internal accounts that should be hidden from the admin Insights page.
 * It is dry-run by default and idempotent.
 *
 *   node --env-file=.env.local --env-file=.env --import tsx \
 *     scripts/seed-insights-exclusions.mts --organization-id <uuid>
 *   node --env-file=.env.local --env-file=.env --import tsx \
 *     scripts/seed-insights-exclusions.mts --organization-id <uuid> --apply
 */
import { createAdminClient } from "@/lib/supabase/admin";

const apply = process.argv.includes("--apply");
const organizationIndex = process.argv.indexOf("--organization-id");
const organizationId = organizationIndex >= 0
  ? process.argv[organizationIndex + 1]
  : process.env.WORK_OS_ORGANIZATION_ID ?? "";
if (!organizationId) {
  throw new Error("pass --organization-id <uuid> or set WORK_OS_ORGANIZATION_ID");
}

const target = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
try {
  console.log(`target host: ${new URL(target).host}`);
} catch {
  console.log("target host: (unresolved)");
}
console.log(`organization: ${organizationId}`);

/** The two L.Perry rows plus the test and shared-inbox accounts. */
const DEFAULT_EXCLUSION_EMAILS = [
  "e2e-verify@wrazyos.com",
  "harryp@maigreeks.com",
  "info@smgllcweb.com",
  "lsperry21@gmail.com",
];

const db = createAdminClient();
const { data, error } = await db
  .from("work_people")
  .select("id,display_name,email,excluded_from_insights")
  .eq("organization_id", organizationId)
  .in("email", DEFAULT_EXCLUSION_EMAILS);
if (error) throw new Error(`load people: ${error.message}`);

const rows = (data ?? []) as Array<{ id: string; display_name: string; email: string | null; excluded_from_insights: boolean }>;
for (const email of DEFAULT_EXCLUSION_EMAILS) {
  const match = rows.filter((row) => String(row.email ?? "").toLowerCase() === email);
  if (!match.length) console.log(`missing: ${email}`);
  for (const row of match) {
    console.log(`${row.excluded_from_insights ? "already excluded" : "would exclude"} | ${row.display_name} | ${row.email}`);
  }
}

const targets = rows.filter((row) => !row.excluded_from_insights);
console.log(`to update: ${targets.length} of ${rows.length} matched rows`);
if (!apply) {
  console.log("dry run — pass --apply to write");
} else if (targets.length) {
  const { error: updateError } = await db
    .from("work_people")
    .update({ excluded_from_insights: true, updated_at: new Date().toISOString() })
    .in("id", targets.map((row) => row.id));
  if (updateError) throw new Error(`update exclusions: ${updateError.message}`);
  console.log(`updated ${targets.length} people`);
} else {
  console.log("nothing to update");
}

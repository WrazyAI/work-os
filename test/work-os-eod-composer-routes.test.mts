import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

test("the structured EOD contract is additive and versioned", async () => {
  const migration = await source("supabase/migrations/0083_work_os_structured_eod.sql");
  assert.match(migration, /work_reports[\s\S]*structured_report jsonb not null default '\{\}'::jsonb/);
  assert.match(migration, /add column if not exists loom_url text/);
  assert.match(migration, /add column if not exists prepared_at timestamptz/);
  assert.match(migration, /work_report_versions[\s\S]*structured_report jsonb not null default '\{\}'::jsonb/);
  const contract = await source("packages/work-os-shared/src/eod-structured.ts");
  assert.match(contract, /EOD_STRUCTURED_VERSION = 1/);
  assert.match(contract, /eodCompositionSignature/);
  assert.match(contract, /normalizeLoomShareUrl/);
  assert.match(contract, /mergeEodComposition/);
});

test("the employee prepares server-side and never needs a Draft button", async () => {
  const prepare = await source("src/app/api/work-os/me/eod/prepare/route.ts");
  assert.match(prepare, /requireWorkOsAccess/);
  assert.match(prepare, /requirePerson: true/);
  assert.match(prepare, /prepareWorkOsEod/);
  const review = await source("src/modules/work-os/employee/EmployeeReview.tsx");
  assert.match(review, /EmployeeEodComposer/);
  assert.match(review, /api\/work-os\/me\/eod\/prepare/);
  assert.match(review, /preparedDates/);
  assert.doesNotMatch(review, /Draft EOD/);
  const composer = await source("src/modules/work-os/employee/EmployeeEodComposer.tsx");
  assert.match(composer, /api\/work-os\/me\/eod\/summary/);
  assert.match(composer, /summarySignature/);
  assert.match(composer, /api\/work-os\/reports\/\$\{reportId\}\/submit/);
  assert.match(composer, /normalizeLoomShareUrl/);
});

test("the scheduled EOD preparation is bounded, secret-gated and idempotent", async () => {
  const route = await source("src/app/api/work-os/eod/run-scheduled/route.ts");
  assert.match(route, /CRON_SECRET/);
  assert.match(route, /runScheduledEodPreparation/);
  assert.match(route, /Math\.min\(48/);
  assert.match(route, /getUTCMinutes\(\) % 15/);
  const job = await source("src/lib/work-os-eod-schedule.ts");
  assert.match(job, /eodDraftShiftGate/);
  assert.match(job, /prepareWorkOsEod/);
  assert.match(job, /already_submitted/);
  assert.match(job, /scheduledRun/);
  assert.match(job, /mode === "due"/, "the due dispatcher uses the employee-specific clock-out query");
  assert.match(job, /scheduled_ends_at/, "the due dispatcher keys off each session's scheduled clock-out");
  const timer = await source("deploy/systemd/work-os-eod.timer");
  assert.match(timer, /OnUnitActiveSec=1min/, "the timer runs every minute so the ten-minute due time is not missed");
});

test("the summary is streamed and has an honest fallback", async () => {
  const route = await source("src/app/api/work-os/me/eod/summary/route.ts");
  assert.match(route, /streamEodSummary/);
  assert.match(route, /X-Work-OS-Summary-Source/);
  assert.match(route, /assembleEodSummary/);
  assert.match(route, /eodDraftShiftGate/);
  const ai = await source("src/lib/aiEod.ts");
  assert.match(ai, /export async function streamEodSummary/);
  assert.match(ai, /stream: true/);
});

test("employee saves and submissions carry the structured composition", async () => {
  const route = await source("src/app/api/work-os/reports/[reportId]/route.ts");
  assert.match(route, /saveWorkOsEodComposition/);
  assert.match(route, /requirePerson: true/);
  const service = await source("src/lib/work-os-eod.ts");
  assert.match(service, /saveWorkOsEodComposition/);
  assert.match(service, /structured_report: structured/);
  assert.match(service, /eodSummaryIsCurrent\(merged\)/);
  assert.match(service, /composeStructuredEodMarkdown/);
  assert.match(service, /loom_url: structuredReport\.loomUrl/);
});

test("the review findings that protect data are guarded", async () => {
  const retention = await source("src/lib/work-os-ghl-retention.ts");
  assert.match(retention, /structured_report/);
  assert.match(retention, /structured_summary.*structured_report|structured_report/);
  const service = await source("src/lib/work-os-eod.ts");
  assert.match(service, /eq\("updated_at", row\.updated_at\)/, "preparation refuses to overwrite a concurrent composition save");
  const review = await source("src/modules/work-os/employee/EmployeeReview.tsx");
  assert.match(review, /api\/work-os\/proposals[\s\S]{0,300}Idempotency-Key/, "proposal decisions keep replay protection");
  const composer = await source("src/modules/work-os/employee/EmployeeEodComposer.tsx");
  assert.match(composer, /persistLatest/);
  assert.match(composer, /saveInFlight/, "autosave requests are serialized");
  assert.match(composer, /assembleEodSummary\(composition\)/, "a broken stream falls back to an assembled summary");
});

test("the admin review renders the same structured report as the employee", async () => {
  const admin = await source("src/modules/work-os/admin/AdminReview.tsx");
  assert.match(admin, /EodStructuredView/);
  assert.match(admin, /normalizeEodStructuredReport/);
  assert.match(admin, /hasStructured/);
  const adminApi = await source("src/modules/work-os/admin/api.ts");
  assert.match(adminApi, /structured_report\?: unknown/);
  assert.match(adminApi, /loom_url\?: string \| null/);
});

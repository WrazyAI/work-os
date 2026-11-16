#!/usr/bin/env node
/**
 * Read-only payroll readiness. Default mode performs no provider call and no
 * database write. `--probe` performs bounded Worktivity reads for one explicit
 * employee; it never creates sessions, recaps, approvals or payroll rows.
 *
 *   node --import tsx scripts/verify-work-os-payroll.mts
 *   node --import tsx scripts/verify-work-os-payroll.mts --probe \
 *     --org <organization-uuid> --person <person-uuid> --period 2026-11-16
 *
 * Output is deliberately aggregate-only: no titles, URLs, summaries, payloads,
 * signed links or credentials.
 */
import { parseArgs } from "node:util";
import {
  PAYROLL_PROVIDER_BASE,
  fetchPayrollProviderPage,
  payrollProviderDeps,
  resolvePayrollProviderConnection,
  unverifiedSemantics,
} from "../src/lib/work-os-payroll-provider";
import { resolvePayrollPeriod } from "../src/lib/work-os-payroll-period";
import type { Span } from "../src/modules/work-os/payroll/contracts";

const { values } = parseArgs({
  options: {
    probe: { type: "boolean", default: false },
    org: { type: "string" },
    person: { type: "string" },
    period: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log("Read-only payroll readiness. See docs/work-os-payroll-operations.md.");
  process.exit(0);
}

const lines: string[] = [];
const say = (line: string) => lines.push(line);
const fail = (line: string) => { say(`BLOCKED: ${line}`); process.exitCode = 1; };

say("Work OS payroll readiness (read-only)");
say(`provider host: ${PAYROLL_PROVIDER_BASE}`);
say(`provider key configured: ${process.env.WORKTIVITY_API_KEY ? "yes" : "no"}`);
say(`payroll models configured: ${process.env.WORK_OS_PAYROLL_TEXT_MODEL || "default policy"}`);
say(`frame model configured: ${process.env.WORK_OS_PAYROLL_FRAME_MODEL || "default policy"}`);
say("");
say("Capture semantics");
say(`  adapter: ${unverifiedSemantics.version}`);
say(`  verified: ${unverifiedSemantics.verified} (direction ${unverifiedSemantics.direction}, ${unverifiedSemantics.durationMs} ms)`);
say("  automatic inactivity deductions: DISABLED until a documented probe confirms");
say("  the meaning of CreateDate and the capture duration.");

if (!values.probe) {
  say("");
  say("Live probe: not requested. Provider enums, field ranges and paging completeness are PENDING.");
  say("Enablement gate: pending. No payroll analysis may claim verified coverage.");
  console.log(lines.join("\n"));
  process.exit();
}

if (!values.org || !values.person || !values.period) {
  fail("--probe requires --org, --person and --period (a first or sixteenth pay date).");
  console.log(lines.join("\n"));
  process.exit();
}
if (!process.env.WORKTIVITY_API_KEY) {
  fail("WORKTIVITY_API_KEY is required for a probe.");
  console.log(lines.join("\n"));
  process.exit();
}

try {
  const period = resolvePayrollPeriod(values.period, "UTC");
  const bounds: Span = {
    startMs: Date.parse(`${period.from}T00:00:00Z`),
    endMs: Date.parse(`${period.through}T00:00:00Z`) + 86_400_000,
  };
  const connection = await resolvePayrollProviderConnection({ organizationId: values.org, personId: values.person });
  say("");
  say(`connection: ${connection.connectionId.slice(0, 8)}… (active, org-scoped)`);
  say(`employee mapping: ${connection.employeeId ? "present" : "missing"}`);
  say(`window: ${period.from}..${period.through} (UTC request bounds)`);
  const deps = payrollProviderDeps({ organizationId: values.org, personId: values.person });
  const page = await fetchPayrollProviderPage({
    scope: { organizationId: values.org, personId: values.person },
    employeeId: connection.employeeId,
    bounds,
    cursor: null,
    connectionId: connection.connectionId,
    semantics: unverifiedSemantics,
  }, deps);
  const statusCodes = new Map<number | null, number>();
  const productivityCodes = new Map<number | null, number>();
  let minActivity = Infinity;
  let maxActivity = -Infinity;
  let zeroSamples = 0;
  let nullActivity = 0;
  let timed = 0;
  for (const log of page.logs) {
    statusCodes.set(log.status, (statusCodes.get(log.status) ?? 0) + 1);
    productivityCodes.set(log.productivityCode, (productivityCodes.get(log.productivityCode) ?? 0) + 1);
    if (log.activity === null) nullActivity += 1;
    else {
      minActivity = Math.min(minActivity, log.activity);
      maxActivity = Math.max(maxActivity, log.activity);
      if (log.activity === 0) zeroSamples += 1;
    }
    if (log.span) timed += 1;
  }
  say(`first page samples: ${page.logs.length}`);
  say(`page complete: ${page.complete}${page.nextCursor ? ` (next cursor ${page.nextCursor})` : ""}`);
  say(`activity range: ${minActivity === Infinity ? "none" : `${minActivity}..${maxActivity}`} raw seconds; null ${nullActivity}; exact zero ${zeroSamples}`);
  say(`status codes: ${[...statusCodes].sort(([a], [b]) => (a ?? -1) - (b ?? -1)).map(([code, count]) => `${code ?? "null"}:${count}`).join(", ") || "none"}`);
  say(`productivity codes: ${[...productivityCodes].map(([code, count]) => `${code ?? "null"}:${count}`).join(", ") || "none"} (labels unrated)`);
  say(`captures with verified spans: ${timed}/${page.logs.length}`);
  say("temporal semantics: UNVERIFIED — CreateDate may mark capture start or end.");
  say("paging completeness: first page only; full-period completeness requires cursor replay.");
  say("Next: compare this aggregate with provider documentation and adjacent");
  say("clock/activity examples, then record the verified semantics version before");
  say("enabling automatic deductions. Do not infer direction from cadence alone.");
} catch (error) {
  fail(error instanceof Error ? error.message : "readiness probe failed");
}
console.log(lines.join("\n"));

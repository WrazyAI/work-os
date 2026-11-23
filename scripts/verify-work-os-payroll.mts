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
  verifiedPayrollSemantics,
} from "../src/lib/work-os-payroll-provider";
import { resolvePayrollPeriod } from "../src/lib/work-os-payroll-period";
import type { Span } from "../src/modules/work-os/payroll/contracts";

const { values } = parseArgs({
  options: {
    probe: { type: "boolean", default: false },
    org: { type: "string" },
    person: { type: "string" },
    period: { type: "string" },
    "verify-models": { type: "boolean", default: false },
    "activate-pilot": { type: "boolean", default: false },
    "confirm-readiness": { type: "boolean", default: false },
    "organization-id": { type: "string" },
    "expected-revision": { type: "string" },
    "cutoff-hour": { type: "string" },
    "enable-auto-approval": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log("Read-only payroll readiness. See docs/work-os-payroll-operations.md.");
  process.exit(0);
}
if (values["activate-pilot"]) {
  const organizationId = values["organization-id"] ?? "";
  const revision = Number(values["expected-revision"] ?? "");
  const cutoffHour = Number(values["cutoff-hour"] ?? "6");
  if (!values["confirm-readiness"] || process.env.WORK_OS_PAYROLL_PILOT_CONFIRM !== "1") {
    console.error("BLOCKED: confirm readiness and set WORK_OS_PAYROLL_PILOT_CONFIRM=1 after recording the client/provider/model gates.");
    process.exit(1);
  }
  if (!organizationId || !Number.isSafeInteger(revision) || revision < 0) {
    console.error("BLOCKED: --organization-id and --expected-revision are required.");
    process.exit(1);
  }
  const { activatePayrollPilot } = await import("../src/lib/work-os-payroll-api");
  const settings = await activatePayrollPilot(organizationId, {
    expectedRevision: revision, autoApprove: values["enable-auto-approval"] === true, cutoffHour, activatedAt: new Date(),
  });
  console.log(JSON.stringify({ organizationId, enabled: settings.enabled, autoApprove: settings.auto_approve_enabled, cutoffHour: settings.cutoff_hour, revision: settings.revision }));
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
say(`  adapter: ${verifiedPayrollSemantics.version}`);
say(`  verified: ${verifiedPayrollSemantics.verified} (direction ${verifiedPayrollSemantics.direction}, ${verifiedPayrollSemantics.durationMs} ms)`);
say("  automatic inactivity deductions: enabled only with explicit non-work evidence");
say("  CreateDate marks the end of the preceding capture interval; live paired samples");
say("  matched Status 0/4 rows to the exact clock-in/clock-out instants.");
if (values["verify-models"]) {
  const { payrollTextRequestBody, payrollVisionRequestBody, resolvePayrollAiPolicy } = await import("../src/lib/work-os-payroll-ai");
  try {
    const policy = resolvePayrollAiPolicy();
    const apiKey = process.env.OPENROUTER_API_KEY;
    const tool = {
      type: "function",
      function: {
        name: "confirmReadiness", description: "Confirm this non-sensitive readiness probe.",
        parameters: { type: "object", additionalProperties: false, required: ["ready"], properties: { ready: { type: "boolean" } } },
      },
    };
    const probe = async (kind: "text" | "vision") => {
      const model = kind === "text" ? policy.textModel : policy.visionModel;
      if (!apiKey) return { ok: false, model, status: "OPENROUTER_API_KEY is not configured" };
      const body = kind === "text"
        ? payrollTextRequestBody(policy, "question", { messages: [{ role: "user", content: "Non-sensitive readiness probe. Return ready=true." }], tools: [tool], tool_choice: { type: "function", function: { name: "confirmReadiness" } } })
        : payrollVisionRequestBody(policy, { max_tokens: 200, messages: [{ role: "user", content: "Non-sensitive readiness probe. Return ready=true." }], tools: [tool], tool_choice: { type: "function", function: { name: "confirmReadiness" } } });
      try {
        const response = await fetch(process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) return { ok: false, model, status: `HTTP ${response.status}` };
        const json = await response.json() as { choices?: Array<{ message?: { tool_calls?: Array<{ function?: { arguments?: string } }> } }> };
        const args = json.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        const parsed = args ? JSON.parse(args) as { ready?: unknown } : {};
        return { ok: parsed.ready === true, model, status: parsed.ready === true ? "structured response received" : "structured response missing" };
      } catch (error) {
        return { ok: false, model, status: error instanceof Error ? error.message.slice(0, 120) : "probe failed" };
      }
    };
    say("");
    say("Model readiness (non-sensitive structured probe)");
    for (const kind of ["text", "vision"] as const) {
      const result = await probe(kind);
      say(`  ${kind}: ${result.model} effort=${policy.effort} ok=${result.ok} (${result.status})`);
    }
  } catch (error) {
    say(`  MODEL CONFIGURATION BLOCKED: ${error instanceof Error ? error.message : "invalid payroll model policy"}`);
    process.exitCode = 1;
  }
}

if (!values.probe) {
  say("");
  say("Live probe: not requested. Provider field ranges and full-period paging remain PENDING.");
  say("Capture semantics: verified from paired live ClockIn/ClockOut samples; automatic");
  say("inactivity deductions still require explicit non-work evidence.");
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
    semantics: verifiedPayrollSemantics,
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
  say("temporal semantics: VERIFIED end-stamped one-minute intervals (paired ClockIn/ClockOut samples).");
  say("paging completeness: first page only; full-period completeness requires cursor replay.");
  say("Next: replay all pages for a complete payroll period before approving evidence.");
} catch (error) {
  fail(error instanceof Error ? error.message : "readiness probe failed");
}
console.log(lines.join("\n"));

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { buildStoredPayrollPeriod, resolvePayrollPeriod, resolvePayrollWindow } from "@/lib/work-os-payroll-period";
import { payrollWindowKey } from "@wrazy/work-os-shared/payroll/window";
import { localDayBounds } from "@/modules/work-os/companion";
import { ensurePayrollRecapApproval } from "@/lib/work-os-payroll-recap-approval";
import { fetchPayrollProviderPage, payrollProviderDeps, payrollProviderFingerprint, resolvePayrollProviderConnection } from "@/lib/work-os-payroll-provider";
import { buildPayrollDayInputs, loadPayrollSources } from "@/lib/work-os-payroll-sources";
import { verifyPayrollSourceToken } from "@/lib/work-os-payroll-freshness";
import { payrollPeriodExpired } from "@/lib/work-os-payroll-retention";
import { calculatePayrollDay } from "@/lib/work-os-payroll-hours";
import { classifyPayrollFrame, selectPayrollFrames } from "@/lib/work-os-payroll-vision";
import { advancePayrollWeekBrief, type BriefCheckpoint } from "@/lib/work-os-payroll-briefs";
import { resolvePayrollAiPolicy, type PayrollAiPolicy } from "@/lib/work-os-payroll-ai";
import type {
  NormalizedActivity, PayrollDayInput, PayrollDayResult, PayrollFrameResult,
  PayrollPeriod, PayrollProgress, PayrollRun, PayrollScope, PayrollSourceManifest,
} from "@/modules/work-os/payroll/contracts";

const LEASE_MS = 180_000;
function providerBounds(period: PayrollPeriod): { startMs: number; endMs: number } {
  return {
    startMs: Date.parse(localDayBounds(period.from, period.timezone).startIso),
    endMs: Date.parse(localDayBounds(period.through, period.timezone).endIso) + 60 * 60_000,
  };
}

export type PayrollRunDeps = {
  now: () => Date;
  ensureRecaps: typeof ensurePayrollRecapApproval;
  fetchProviderPage: typeof fetchPayrollProviderPage;
  loadSources: typeof loadPayrollSources;
  classifyFrame: typeof classifyPayrollFrame;
  calculateDay: typeof calculatePayrollDay;
  advanceBrief: typeof advancePayrollWeekBrief;
  resolveConnection?: typeof resolvePayrollProviderConnection;
  fetchApps?: (input: { employeeId: string; start: string; end: string }) => Promise<Array<{ name: string; minutes: number; productivity: number | null; category: string | null }>>;
  providerDeps?: ReturnType<typeof payrollProviderDeps>;
  policy?: PayrollAiPolicy;
  signal?: AbortSignal;
};

export function payrollRunDeps(scope: PayrollScope): PayrollRunDeps {
  return {
    now: () => new Date(),
    ensureRecaps: ensurePayrollRecapApproval,
    fetchProviderPage: fetchPayrollProviderPage,
    loadSources: loadPayrollSources,
    classifyFrame: classifyPayrollFrame,
    calculateDay: calculatePayrollDay,
    advanceBrief: advancePayrollWeekBrief,
    resolveConnection: resolvePayrollProviderConnection,
    fetchApps: async (input) => (await import("@/lib/worktivityAudit")).fetchAppsSummary(input),
    providerDeps: payrollProviderDeps(scope),
    policy: resolvePayrollAiPolicy(),
  };
}

type RunRow = Record<string, unknown>;
type Json = Record<string, unknown>;

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function iso(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  return null;
}
function dateKey(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  const match = typeof value === "string" ? value.match(/^\d{4}-\d{2}-\d{2}/) : null;
  return match ? match[0] : null;
}

export class PayrollLeaseLostError extends Error {
  readonly code = "payroll_lease_lost";
  constructor() { super("The payroll run lease was lost; another advancer owns this run."); this.name = "PayrollLeaseLostError"; }
}

function progress(run: RunRow): PayrollProgress {
  const saved = object(run.progress);
  return {
    phase: (String(run.phase ?? "recaps") as PayrollProgress["phase"]),
    message: String(saved.message ?? "Payroll analysis is queued."),
    daysDone: Number(saved.daysDone ?? 0), days: Number(saved.days ?? 0),
    framesClassified: Number(saved.framesClassified ?? 0), framesReused: Number(saved.framesReused ?? 0),
    findings: Number(saved.findings ?? 0), remaining: Number(saved.remaining ?? 0),
    status: String(run.status ?? "queued") as PayrollProgress["status"],
    nextAttemptAt: iso(run.next_attempt_at),
  };
}
function mapRun(run: RunRow): PayrollRun {
  return {
    id: String(run.id), reviewId: String(run.review_id), scope: { organizationId: String(run.organization_id), personId: String(run.person_id) },
    targetRevision: Number(run.target_revision), asOf: iso(run.as_of) ?? new Date().toISOString(),
    progress: progress(run), rowVersion: String(run.row_version ?? "0"),
  };
}
export { mapRun as mapPayrollRun };

async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function startPayrollRun(access: WorkOsAccess, input: {
  personId: string; payDate?: string; from?: string; through?: string; requestKey: string;
}): Promise<PayrollRun> {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll analysis is admin-only.");
  if (!input.requestKey.trim()) throw new WorkOsValidationError("requestKey is required");
  if (Boolean(input.from) !== Boolean(input.through)) throw new WorkOsValidationError("from and through are required together");
  if (!input.from && !input.payDate) throw new WorkOsValidationError("payDate or a from/through window is required");
  const person = await getPool().query(`SELECT coalesce((SELECT max(o.timezone) FROM work_employee_onboarding o
      WHERE o.organization_id=p.organization_id AND o.person_id=p.id), to_jsonb(p)->>'timezone', 'UTC') AS timezone
    FROM work_people p WHERE p.organization_id=$1 AND p.id=$2`, [access.organizationId, input.personId]);
  if (!person.rows.length) throw new WorkOsValidationError("Payroll person not found");
  const timezone = String(person.rows[0].timezone ?? "UTC");
  const period = input.from && input.through
    ? resolvePayrollWindow(input.from, input.through, timezone)
    : resolvePayrollPeriod(input.payDate!, timezone);
  if (await payrollPeriodExpired(access.organizationId, input.personId, period.payDate)) {
    throw new WorkOsConflictError("This payroll period expired and cannot be regenerated.", "payroll_period_expired");
  }
  const windowKey = payrollWindowKey(period.from, period.through);
  return transaction(async (client) => {
    const review = await client.query(`INSERT INTO work_payroll_reviews
      (organization_id,person_id,period_start,period_end,pay_date,timezone,status,retention_expires_at,window_key)
      VALUES ($1,$2,$3::date,$4::date,$5::date,$6,'draft',$5::date + interval '30 days',$7)
      ON CONFLICT (organization_id,person_id,window_key) DO UPDATE SET updated_at=now()
      RETURNING *`, [access.organizationId, input.personId, period.from, period.through, period.payDate, timezone, windowKey]);
    const reviewRow = review.rows[0];
    if (String(reviewRow.status) === "approved") throw new WorkOsConflictError("Reopen the approved payroll review before analyzing it again.", "payroll_approved");
    const active = await client.query(`SELECT * FROM work_payroll_runs WHERE organization_id=$1 AND review_id=$2 AND status IN ('queued','running') ORDER BY created_at LIMIT 1`, [access.organizationId, reviewRow.id]);
    if (active.rows.length) return { ...mapRun(active.rows[0]), rowVersion: String(reviewRow.row_version) };
    const duplicate = await client.query(`SELECT * FROM work_payroll_runs WHERE organization_id=$1 AND review_id=$2 AND request_key=$3`, [access.organizationId, reviewRow.id, input.requestKey]);
    if (duplicate.rows.length) return { ...mapRun(duplicate.rows[0]), rowVersion: String(reviewRow.row_version) };
    const target = await client.query(`SELECT coalesce(max(target_revision),0)+1 AS revision FROM work_payroll_runs WHERE organization_id=$1 AND review_id=$2`, [access.organizationId, reviewRow.id]);
    const inserted = await client.query(`INSERT INTO work_payroll_runs
      (organization_id,review_id,person_id,status,phase,progress,target_revision,as_of,request_key,resolved_policy)
      VALUES ($1,$2,$3,'queued','recaps',$4::jsonb,$5,$6,$7,'{}')
      RETURNING *`,
    [access.organizationId, reviewRow.id, input.personId,
      JSON.stringify({ message: "Queued payroll analysis.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0 }),
      Number(target.rows[0].revision), new Date().toISOString(), input.requestKey]);
    return { ...mapRun(inserted.rows[0]), rowVersion: String(reviewRow.row_version) };
  });
}

export async function cancelPayrollRun(access: WorkOsAccess, runId: string, command: { rowVersion: string }): Promise<PayrollRun> {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll analysis is admin-only.");
  return transaction(async (client) => {
    const run = await client.query(`SELECT r.*,v.row_version AS review_row_version FROM work_payroll_runs r
      JOIN work_payroll_reviews v ON v.organization_id=r.organization_id AND v.id=r.review_id
      WHERE r.organization_id=$1 AND r.id=$2 FOR UPDATE`, [access.organizationId, runId]);
    if (!run.rows.length) throw new WorkOsValidationError("Payroll run not found");
    if (String(run.rows[0].review_row_version) !== command.rowVersion) throw new WorkOsConflictError("The payroll review changed. Reload it before cancelling.", "review_version_conflict");
    const status = String(run.rows[0].status);
    if (status === "canceled") return mapRun(run.rows[0]);
    if (status !== "queued" && status !== "running") {
      throw new WorkOsConflictError("This payroll analysis already finished and cannot be cancelled.", "payroll_run_finished");
    }
    const updated = await client.query(`UPDATE work_payroll_runs SET status='canceled', cancel_requested_at=now(),
      lease_token=NULL, lease_until=NULL, updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`, [access.organizationId, runId]);
    return mapRun(updated.rows[0]);
  });
}

async function claimRun(scope: PayrollScope, runId: string, at: Date): Promise<{ run: RunRow; token: string } | null> {
  return transaction(async (client) => {
    const token = randomUUID();
    const claimed = await client.query(`UPDATE work_payroll_runs SET status='running', lease_token=$3, lease_until=$4, updated_at=$5
      WHERE organization_id=$1 AND id=$2 AND status IN ('queued','running')
        AND (lease_until IS NULL OR lease_until <= $5) AND cancel_requested_at IS NULL
      RETURNING *`,
    [scope.organizationId, runId, token, new Date(at.getTime() + LEASE_MS).toISOString(), at.toISOString()]);
    return claimed.rows.length ? { run: claimed.rows[0], token } : null;
  });
}

async function persistRun(scope: PayrollScope, runId: string, token: string, at: Date, patch: {
  status?: string; phase?: string; progress?: Json; cursor?: Json; inputManifest?: Json;
  inputArtifact?: Json; fetchCursor?: Json; sourceHash?: string; error?: string | null;
}): Promise<void> {
  await transaction(async (client) => {
    const updated = await client.query(`UPDATE work_payroll_runs SET
      status=coalesce($4,status), phase=coalesce($5,phase), progress=coalesce($6::jsonb,progress),
      cursor=coalesce($7::jsonb,cursor), input_manifest=coalesce($8::jsonb,input_manifest),
      input_artifact=coalesce($9::jsonb,input_artifact), fetch_cursor=coalesce($10::jsonb,fetch_cursor),
      source_hash=coalesce($11,source_hash), error=$12, updated_at=$13
      WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND lease_until > $13
      RETURNING id`,
    [scope.organizationId, runId, token, patch.status ?? null, patch.phase ?? null,
      patch.progress ? JSON.stringify(patch.progress) : null, patch.cursor ? JSON.stringify(patch.cursor) : null,
      patch.inputManifest ? JSON.stringify(patch.inputManifest) : null,
      patch.inputArtifact ? JSON.stringify(patch.inputArtifact) : null,
      patch.fetchCursor ? JSON.stringify(patch.fetchCursor) : null,
      patch.sourceHash ?? null, patch.error ?? null, at.toISOString()]);
    if (!updated.rows.length) throw new PayrollLeaseLostError();
  });
}

async function release(scope: PayrollScope, runId: string, token: string): Promise<void> {
  await getPool().query(`UPDATE work_payroll_runs SET lease_token=NULL, lease_until=NULL WHERE organization_id=$1 AND id=$2 AND lease_token=$3`, [scope.organizationId, runId, token]).catch(() => undefined);
}

function periodOf(review: RunRow): PayrollPeriod {
  return buildStoredPayrollPeriod(
    dateKey(review.period_start)!, dateKey(review.period_end)!, dateKey(review.pay_date)!,
    String(review.timezone ?? "UTC"),
  );
}

function dayTotals(days: PayrollDayResult[]) {
  const totals = { recorded: 0, eligibleTracked: 0, outside: 0, break: 0, inactivity: 0, held: 0, manualExcluded: 0, recommended: 0, approved: 0 };
  for (const day of days) for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += day.minutes[key];
  return totals;
}

async function persistDay(scope: PayrollScope, run: RunRow, day: PayrollDayResult, at: Date, token: string, frameResults: Record<string, PayrollFrameResult> = {}, frameCandidates: PayrollDayInput["frameCandidates"] = [], input?: PayrollDayInput): Promise<void> {
  const sessionIds = JSON.stringify((input?.sessions ?? []).map((session) => session.id));
  const scheduleSnapshot = JSON.stringify(input ? {
    scheduleSource: input.sessions[0]?.scheduleSource ?? "none",
    sessions: input.sessions.map((session) => ({ id: session.id, recorded: session.recorded, eligible: session.eligible, scheduleSource: session.scheduleSource })),
    breaks: input.breaks,
  } : {});
  await transaction(async (client) => {
    const saved = await client.query(`INSERT INTO work_payroll_days
      (organization_id,review_id,person_id,analysis_revision,local_date,week,status,session_ids,schedule_snapshot,recorded_ms,eligible_ms,exact_ms,partition,
       tracked_minutes,break_minutes,inactivity_minutes,outside_minutes,held_minutes,recommended_minutes,manual_excluded_minutes,
       activity_summary,findings_summary,source_hash,original_result,result)
      VALUES ($1,$2,$3,$4,$5::date,$6,'calculated',$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19,'{}','{}',$20,$21::jsonb,$21::jsonb)
      ON CONFLICT (organization_id,review_id,analysis_revision,local_date) DO UPDATE SET
        session_ids=excluded.session_ids, schedule_snapshot=excluded.schedule_snapshot,
        recorded_ms=excluded.recorded_ms, eligible_ms=excluded.eligible_ms, exact_ms=excluded.exact_ms,
        partition=excluded.partition, tracked_minutes=excluded.tracked_minutes, break_minutes=excluded.break_minutes,
        inactivity_minutes=excluded.inactivity_minutes, outside_minutes=excluded.outside_minutes, held_minutes=excluded.held_minutes,
        recommended_minutes=excluded.recommended_minutes, manual_excluded_minutes=excluded.manual_excluded_minutes,
        source_hash=excluded.source_hash, original_result=excluded.original_result, result=excluded.result, updated_at=now()
      RETURNING id`,
    [scope.organizationId, run.review_id, scope.personId, run.target_revision, day.date, day.week,
      sessionIds, scheduleSnapshot,
      Object.values(day.exactMs).reduce((sum, value) => sum + value, 0),
      day.exactMs.payable + day.exactMs.break + day.exactMs.inactivity + day.exactMs.held + day.exactMs.manual, JSON.stringify(day.exactMs), JSON.stringify(day.partition),
      day.minutes.eligibleTracked, day.minutes.break, day.minutes.inactivity, day.minutes.outside, day.minutes.held,
      day.minutes.recommended, day.minutes.manualExcluded, day.sourceHash, JSON.stringify(day)]);
    const dayId = String(saved.rows[0].id);
    for (const finding of day.findings) {
      await client.query(`INSERT INTO work_payroll_findings
        (organization_id,review_id,person_id,analysis_revision,day_id,finding_key,kind,status,effect,blocks_approval,
         required_action,start_at,end_at,duration_ms,minutes,reason,evidence,citations,source_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19)
        ON CONFLICT (organization_id,review_id,person_id,analysis_revision,finding_key) DO UPDATE SET
          status=excluded.status, effect=excluded.effect, blocks_approval=excluded.blocks_approval,
          reason=excluded.reason, source_hash=excluded.source_hash, updated_at=now()`,
      [scope.organizationId, run.review_id, scope.personId, run.target_revision, dayId, finding.key, finding.kind,
        finding.status, finding.effect, finding.blocksApproval, finding.requiredAction,
        finding.span ? new Date(finding.span.startMs).toISOString() : null,
        finding.span ? new Date(finding.span.endMs).toISOString() : null,
        finding.durationMs, finding.minutes, finding.reason, JSON.stringify({}), JSON.stringify(finding.citations), finding.sourceHash]);
    }
    for (const frame of frameCandidates) {
      const result = frameResults[frame.summaryId];
      if (!result) continue;
      await client.query(`INSERT INTO work_payroll_frame_findings
        (organization_id,review_id,person_id,analysis_revision,day_id,screenshot_summary_id,evidence_event_id,captured_at,category,confidence,reason,model,prompt_version,rubric_hash,classification_key,source_hash,policy_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'payroll-frame-rubric-v1',$14,$15,$16)
        ON CONFLICT (organization_id,review_id,person_id,analysis_revision,day_id,screenshot_summary_id,classification_key) DO NOTHING`,
      [scope.organizationId, run.review_id, scope.personId, run.target_revision, dayId, frame.summaryId, frame.evidenceEventId,
        frame.capturedAt, result.category, result.confidence, result.reason, result.model, result.promptVersion,
        result.classificationKey, result.sourceHash, frame.policyVersion]);
    }
    const guarded = await client.query(`UPDATE work_payroll_runs SET cursor=$4::jsonb, updated_at=$5
      WHERE organization_id=$1 AND id=$2 AND lease_token=$3 AND lease_until > $5 RETURNING id`,
    [scope.organizationId, run.id, token, JSON.stringify({ dayIndex: Number(object(run.cursor).dayIndex ?? 0) + 1 }), at.toISOString()]);
    if (!guarded.rows.length) throw new PayrollLeaseLostError();
  });
}

export async function advancePayrollRun(scope: PayrollScope, runId: string, deps: PayrollRunDeps, at: Date): Promise<PayrollProgress> {
  const claim = await claimRun(scope, runId, at);
  if (!claim) {
    const row = await getPool().query(`SELECT * FROM work_payroll_runs WHERE organization_id=$1 AND id=$2`, [scope.organizationId, runId]);
    return row.rows.length ? progress(row.rows[0]) : { phase: "recaps", message: "Run not found.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "failed", nextAttemptAt: null };
  }
  const { run, token } = claim;
  const reviewQuery = await getPool().query(`SELECT * FROM work_payroll_reviews WHERE organization_id=$1 AND id=$2`, [scope.organizationId, run.review_id]);
  const review = reviewQuery.rows[0];
  if (!review) { await release(scope, runId, token); return progress(run); }
  const period = periodOf(review);
  const artifact = object(run.input_artifact);
  const cursor = object(run.cursor);
  const policy = deps.policy ?? resolvePayrollAiPolicy();
  try {
    if (String(run.cancel_requested_at ?? "")) {
      await persistRun(scope, runId, token, at, { status: "canceled", phase: "done", progress: { message: "Payroll analysis was cancelled.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0 } });
      await release(scope, runId, token);
      const canceled = await getPool().query(`SELECT * FROM work_payroll_runs WHERE organization_id=$1 AND id=$2`, [scope.organizationId, runId]);
      return progress(canceled.rows[0]);
    }
    if (String(review.status) === "approved") {
      await persistRun(scope, runId, token, at, { status: "failed", error: "approved_review", progress: { message: "Approved review cannot be analyzed without an explicit reopen.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0 } });
      await release(scope, runId, token);
      return { phase: "done", message: "Approved review cannot be analyzed.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "failed", nextAttemptAt: null };
    }
    const phase = String(run.phase) as PayrollProgress["phase"];
    if (phase === "recaps") {
      const result = await deps.ensureRecaps(scope, period, at, 100);
      await persistRun(scope, runId, token, at, { phase: "activity", progress: { message: result.complete ? "Recaps settled; loading historical sources." : `Pending recaps remain (${result.pending}); loading sources without auto-approving them.`, daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: result.pending } });
    } else if (phase === "activity") {
      const manifest = await deps.loadSources(scope, period, new Date(String(run.as_of)));
      await persistRun(scope, runId, token, at, { phase: "evidence", inputManifest: manifest as unknown as Json, sourceHash: manifest.sourceToken, progress: { message: "Sources captured; reading provider evidence.", days: manifest.days.length, daysDone: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: manifest.days.length } });
    } else if (phase === "evidence") {
      const consent = await (await import("@/lib/work-os-onboarding")).employeeTrackingConsent(scope.organizationId, scope.personId);
      if (!consent.tracking) {
        await persistRun(scope, runId, token, at, { status: "failed", error: "tracking_consent_required", progress: { message: "Tracking consent is required before provider evidence can be ingested.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0 } });
        await release(scope, runId, token);
        return { phase: "done", message: "Tracking consent is required.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "failed", nextAttemptAt: null };
      }
      const resolve = deps.resolveConnection ?? resolvePayrollProviderConnection;
      const connection = await resolve(scope);
      const manifest = run.input_manifest as unknown as PayrollSourceManifest;
      const pages = object(run.fetch_cursor);
      const cursor = typeof pages.cursor === "string" ? pages.cursor : null;
      const page = await deps.fetchProviderPage({
        scope, employeeId: connection.employeeId, bounds: providerBounds(period),
        cursor, connectionId: connection.connectionId,
      }, deps.providerDeps ?? payrollProviderDeps(scope));
      if (!page.complete && (!page.nextCursor || page.nextCursor === cursor)) {
        await persistRun(scope, runId, token, at, {
          status: "failed", error: "provider_pagination_incomplete",
          progress: { message: "The provider did not return the next evidence page. Re-analyze when it is available.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0 },
        });
        await release(scope, runId, token);
        return { phase: "done", message: "Provider evidence pagination is incomplete.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "failed", nextAttemptAt: null };
      }
      const logs = Array.isArray(artifact.logs) ? artifact.logs as NormalizedActivity[] : [];
      const combinedLogs = [...logs, ...page.logs];
      const previousProvider = object(artifact.provider);
      const watermark = String(page.watermark && page.watermark > String(previousProvider.watermark ?? "")
        ? page.watermark : previousProvider.watermark ?? "");
      let apps = object(artifact.apps);
      if (page.complete && !Array.isArray(apps.items)) {
        try {
          const usage = await (deps.fetchApps ?? (async (input) => (await import("@/lib/worktivityAudit")).fetchAppsSummary(input)))({ employeeId: connection.employeeId, start: period.from, end: period.through });
          apps = {
            items: usage.map((item) => ({ name: item.name, durationMs: item.minutes * 60_000, productivityCode: item.productivity, category: item.category })),
            complete: true, coverage: [], enumLabels: {},
          };
        } catch {
          apps = { items: [], complete: false, coverage: ["App usage unavailable for this period"], enumLabels: {} };
        }
      }
      await persistRun(scope, runId, token, at, {
        phase: page.complete ? "classify" : "evidence",
        fetchCursor: { cursor: page.nextCursor },
        inputArtifact: {
          ...artifact, logs: combinedLogs, apps,
          provider: {
            complete: page.complete,
            watermark,
            verifiedAt: page.complete ? at.toISOString() : previousProvider.verifiedAt ?? null,
            fingerprint: page.complete ? payrollProviderFingerprint(combinedLogs) : null,
            pages: Number(previousProvider.pages ?? 0) + 1,
          },
        },
        progress: { message: page.complete ? "Provider pages complete; classifying ambiguous frames." : "Reading provider evidence pages.", days: manifest.days.length, daysDone: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: manifest.days.length },
      });
    } else if (phase === "classify") {
      const consent = await (await import("@/lib/work-os-onboarding")).employeeTrackingConsent(scope.organizationId, scope.personId);
      if (!consent.tracking) {
        await persistRun(scope, runId, token, at, { status: "failed", error: "tracking_consent_required", progress: { message: "Tracking consent was withdrawn before frame classification.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0 } });
        await release(scope, runId, token);
        return { phase: "done", message: "Tracking consent was withdrawn.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "failed", nextAttemptAt: null };
      }
      const manifest = run.input_manifest as unknown as PayrollSourceManifest;
      const logs = Array.isArray(artifact.logs) ? artifact.logs as NormalizedActivity[] : [];
      const providerState = object(artifact.provider);
      const provider = { scope, connectionId: "run", bounds: providerBounds(period), logs, complete: providerState.complete === true, watermark: String(providerState.watermark ?? ""), verifiedAt: iso(providerState.verifiedAt) ?? at.toISOString(), semantics: { version: "worktivity-activitylog-v1", verified: false, direction: "unknown" as const, durationMs: 60_000 }, apps: { items: [], complete: true, coverage: [], enumLabels: {} } };
      const days = buildPayrollDayInputs(manifest, provider);
      const dayIndex = Number(cursor.classifyIndex ?? 0);
      if (dayIndex >= days.length) {
        await persistRun(scope, runId, token, at, { phase: "days", progress: { message: "Frame classification complete; calculating hours.", days: days.length, daysDone: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: days.length } });
      } else {
        const frameResults = object(artifact.frameResults) as Record<string, PayrollFrameResult>;
        const day = days[dayIndex];
        for (const frame of selectPayrollFrames(day)) {
          if (frameResults[frame.summaryId]) continue;
          frameResults[frame.summaryId] = await deps.classifyFrame(scope, frame, policy, deps.signal);
        }
        const nextClassify = dayIndex + 1;
        await persistRun(scope, runId, token, at, { cursor: { ...cursor, classifyIndex: nextClassify }, inputArtifact: { ...artifact, frameResults }, progress: { message: "Classifying representative frames.", days: days.length, daysDone: nextClassify, framesClassified: Object.keys(frameResults).length, framesReused: 0, findings: 0, remaining: days.length - nextClassify } });
        if (nextClassify >= days.length) await persistRun(scope, runId, token, at, { phase: "days" });
      }
    } else if (phase === "days") {
      const consent = await (await import("@/lib/work-os-onboarding")).employeeTrackingConsent(scope.organizationId, scope.personId);
      if (!consent.tracking) {
        await persistRun(scope, runId, token, at, { status: "failed", error: "tracking_consent_required", progress: { message: "Tracking consent was withdrawn before payroll hours were calculated.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0 } });
        await release(scope, runId, token);
        return { phase: "done", message: "Tracking consent was withdrawn.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "failed", nextAttemptAt: null };
      }
      const manifest = run.input_manifest as unknown as PayrollSourceManifest;
      const logs = Array.isArray(artifact.logs) ? artifact.logs as NormalizedActivity[] : [];
      const providerState = object(artifact.provider);
      const provider = { scope, connectionId: "run", bounds: providerBounds(period), logs, complete: providerState.complete === true, watermark: String(providerState.watermark ?? ""), verifiedAt: iso(providerState.verifiedAt) ?? at.toISOString(), semantics: { version: "worktivity-activitylog-v1", verified: false, direction: "unknown" as const, durationMs: 60_000 }, apps: { items: [], complete: true, coverage: [], enumLabels: {} } };
      const days = buildPayrollDayInputs(manifest, provider);
      const dayIndex = Number(cursor.dayIndex ?? 0);
      if (dayIndex >= days.length) {
        await persistRun(scope, runId, token, at, { phase: "briefs", progress: { message: "Daily hours complete; compiling week briefs.", days: days.length, daysDone: days.length, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0 } });
      } else {
        const frameResults = object(artifact.frameResults) as Record<string, PayrollFrameResult>;
        const frameSignals = days[dayIndex].frameCandidates.flatMap((frame) => {
          const result = frameResults[frame.summaryId];
          if (!result) return [];
          const atMs = Date.parse(frame.capturedAt);
          return [{ span: { startMs: atMs, endMs: atMs + 60_000 }, category: result.category, confidence: result.confidence, citations: [], findingKey: `frame:${frame.summaryId}` }];
        });
        const result = deps.calculateDay({ ...days[dayIndex], frameSignals });
        const providerState = object(artifact.provider);
        const providerWatermark = String(providerState.watermark ?? "");
        const providerVerifiedAt = iso(providerState.verifiedAt);
        const providerFingerprint = String(providerState.fingerprint ?? "") || payrollProviderFingerprint(logs);
        await getPool().query(`INSERT INTO work_payroll_analysis_revisions
          (organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot,source_token,provider_watermark,provider_verified_at,resolved_policy,apps_summary)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb)
          ON CONFLICT (organization_id,review_id,person_id,analysis_revision) DO NOTHING`,
        [scope.organizationId, run.review_id, scope.personId, run.target_revision, manifest.hash, manifest.policyVersion,
          run.as_of, JSON.stringify(manifest), JSON.stringify({ weekSources: manifest.weekSources }), run.source_hash,
          providerWatermark, providerVerifiedAt, JSON.stringify({ providerFingerprint }), JSON.stringify(object(artifact.apps))]);
        await persistDay(scope, run, result, at, token, artifact.frameResults as Record<string, PayrollFrameResult>, days[dayIndex].frameCandidates, days[dayIndex]);
        await persistRun(scope, runId, token, at, { progress: { message: "Calculating daily hours.", days: days.length, daysDone: dayIndex + 1, framesClassified: 0, framesReused: 0, findings: result.findings.length, remaining: days.length - dayIndex - 1 } });
      }
    } else if (phase === "briefs") {
      const week = Number(cursor.briefWeek ?? 1);
      const sources = week === 1 ? (run.input_manifest as unknown as PayrollSourceManifest).weekSources[0] : (run.input_manifest as unknown as PayrollSourceManifest).weekSources[1];
      const checkpoints = object(artifact.briefCheckpoints) as Record<string, BriefCheckpoint>;
      const key = `week-${week}`;
      const result = await deps.advanceBrief(scope, sources, policy, checkpoints[key] ?? null, deps.signal);
      checkpoints[key] = result.brief.status === "failed" ? { ...result.checkpoint, phase: "done" } : result.checkpoint;
      const weekBriefs = object(artifact.weekBriefs);
      weekBriefs[key] = result.brief;
      const bothDone = Boolean(checkpoints["week-1"]?.phase === "done" && checkpoints["week-2"]?.phase === "done");
      const nextWeek = week === 1 ? 2 : 1;
      if (result.brief.status !== "missing") {
        await getPool().query(`INSERT INTO work_payroll_week_briefs
          (organization_id,review_id,person_id,analysis_revision,week,period_start,period_end,status,title,summary_markdown,
           summary_citations,themes,open_items,gaps,sources,source_hash,model,prompt_version,generated_at)
          VALUES ($1,$2,$3,$4,$5,$6::date,$7::date,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,now())
          ON CONFLICT (organization_id,review_id,analysis_revision,week) DO UPDATE SET
            status=excluded.status, title=excluded.title, summary_markdown=excluded.summary_markdown,
            summary_citations=excluded.summary_citations, themes=excluded.themes, open_items=excluded.open_items,
            gaps=excluded.gaps, sources=excluded.sources, source_hash=excluded.source_hash, generated_at=now()`,
        [scope.organizationId, run.review_id, scope.personId, run.target_revision, week, sources.from, sources.through,
          result.brief.status, result.brief.title, result.brief.summary, JSON.stringify(result.brief.summaryCitations),
          JSON.stringify(result.brief.themes), JSON.stringify(result.brief.openItems), JSON.stringify(result.brief.gaps),
          JSON.stringify({ recaps: sources.recaps.map((recap) => ({ id: recap.id, reviewVersion: recap.reviewVersion, reviewSource: recap.reviewSource })) }),
          result.brief.sourceHash, policy.textModel, "payroll-week-brief-v1"]);
      }
      await persistRun(scope, runId, token, at, {
        phase: bothDone ? "done" : "briefs",
        cursor: { ...cursor, briefWeek: nextWeek },
        inputArtifact: { ...artifact, briefCheckpoints: checkpoints, weekBriefs },
        progress: { message: bothDone ? "Briefs ready; publishing analysis." : "Compiling week briefs.", days: Number(object(run.progress).days ?? 0), daysDone: Number(object(run.progress).daysDone ?? 0), framesClassified: Number(object(run.progress).framesClassified ?? 0), framesReused: Number(object(run.progress).framesReused ?? 0), findings: Number(object(run.progress).findings ?? 0), remaining: bothDone ? 0 : 1 },
      });
    } else if (phase === "done") {
      await transaction(async (client) => {
        const currentRun = await client.query(`SELECT status,cancel_requested_at,lease_token
          FROM work_payroll_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [scope.organizationId, runId]);
        const current = currentRun.rows[0];
        if (!current || String(current.status) !== "running" || current.cancel_requested_at
          || String(current.lease_token ?? "") !== token) throw new PayrollLeaseLostError();
        await verifyPayrollSourceToken(client, scope, String(run.source_hash ?? ""));
        const days = await client.query(`SELECT * FROM work_payroll_days WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ORDER BY local_date`, [scope.organizationId, run.review_id, run.target_revision]);
        const results = days.rows.map((row) => object(row.result) as unknown as PayrollDayResult);
        const totals = dayTotals(results);
        const manifest = run.input_manifest as unknown as PayrollSourceManifest;
        const providerState = object(artifact.provider);
        const providerWatermark = String(providerState.watermark ?? "");
        const providerVerifiedAt = iso(providerState.verifiedAt);
        const providerFingerprint = String(providerState.fingerprint ?? "")
          || payrollProviderFingerprint(Array.isArray(artifact.logs) ? artifact.logs as NormalizedActivity[] : []);
        await client.query(`INSERT INTO work_payroll_analysis_revisions
          (organization_id,review_id,person_id,analysis_revision,source_hash,policy_version,as_of,input_manifest,citation_snapshot,source_token,provider_watermark,provider_verified_at,resolved_policy,apps_summary)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb,$14::jsonb)
          ON CONFLICT (organization_id,review_id,person_id,analysis_revision) DO NOTHING`,
        [scope.organizationId, run.review_id, scope.personId, run.target_revision, manifest.hash, manifest.policyVersion, run.as_of, JSON.stringify(manifest), JSON.stringify({ weekSources: manifest.weekSources }), run.source_hash,
          providerWatermark, providerVerifiedAt, JSON.stringify({ providerFingerprint }), JSON.stringify(object(artifact.apps))]);
        const blocked = results.some((day) => day.blockers.length || day.findings.some((finding) => finding.blocksApproval));
        const published = await client.query(`UPDATE work_payroll_reviews SET
          status=$4, analysis_revision=$5, row_version=row_version+1, source_hash=$6, totals=$7::jsonb,
          last_analyzed_at=now(), updated_at=now()
          WHERE organization_id=$1 AND id=$2 AND row_version=$3 AND status <> 'approved'
          RETURNING row_version`,
        [scope.organizationId, run.review_id, review.row_version, blocked ? "needs_review" : "ready", run.target_revision, manifest.hash, JSON.stringify(totals)]);
        if (!published.rows.length) throw new PayrollLeaseLostError();
        await client.query(`UPDATE work_payroll_runs SET status='done', phase='done', progress=$3::jsonb, lease_token=NULL, lease_until=NULL, finished_at=now(), updated_at=now()
          WHERE organization_id=$1 AND id=$2`, [scope.organizationId, runId,
          JSON.stringify({ message: "Payroll analysis is ready.", daysDone: results.length, days: results.length, framesClassified: 0, framesReused: 0, findings: results.reduce((sum, day) => sum + day.findings.length, 0), remaining: 0 })]);
      });
      return { phase: "done", message: "Payroll analysis is ready.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "done", nextAttemptAt: null };
    } else {
      throw new Error(`Unknown payroll run phase: ${phase}`);
    }
    await release(scope, runId, token);
    const current = await getPool().query(`SELECT * FROM work_payroll_runs WHERE organization_id=$1 AND id=$2`, [scope.organizationId, runId]);
    return progress(current.rows[0]);
  } catch (error) {
    await release(scope, runId, token);
    if (error instanceof PayrollLeaseLostError) throw error;
    const message = error instanceof Error ? error.message : "Payroll analysis failed.";
    await getPool().query(`UPDATE work_payroll_runs SET status='failed', error=$3,
        progress=jsonb_set(coalesce(progress,'{}'::jsonb),'{message}',to_jsonb($3::text)),
        lease_token=NULL, lease_until=NULL, updated_at=now()
      WHERE organization_id=$1 AND id=$2`, [scope.organizationId, runId, message.slice(0, 300)]).catch(() => undefined);
    return { phase: "done", message, daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "failed", nextAttemptAt: null };
  }
}

async function runStateKey(scope: PayrollScope, runId: string): Promise<string> {
  const { rows } = await getPool().query(`SELECT status,phase,progress,cursor,fetch_cursor,
      md5(coalesce(input_artifact::text,'')) AS artifact_digest
    FROM work_payroll_runs WHERE organization_id=$1 AND id=$2`, [scope.organizationId, runId]);
  return rows[0] ? JSON.stringify(rows[0]) : "";
}

/** Advance one run until it settles or the budget runs out. A single step is
 * not enough: provider paging, frame classification, daily calculation and two
 * briefs can each take a turn, and a five-minute cron is not reliable enough to
 * deliver them one at a time. Repeated identical states stop the drain so a
 * losing lease or a provider that stopped moving cannot spin forever. */
export async function drainPayrollRun(scope: PayrollScope, runId: string, deps: PayrollRunDeps, options: {
  budgetMs?: number; maxSteps?: number; now?: () => Date;
} = {}): Promise<PayrollProgress> {
  const budgetMs = Math.max(1_000, Math.min(180_000, Math.trunc(options.budgetMs ?? 45_000)));
  const maxSteps = Math.max(1, Math.min(240, Math.trunc(options.maxSteps ?? 80)));
  const now = options.now ?? (() => new Date());
  const startedAt = Date.now();
  let latest: PayrollProgress | null = null;
  let previous = "";
  let unchanged = 0;
  for (let step = 0; step < maxSteps; step += 1) {
    try {
      latest = await advancePayrollRun(scope, runId, deps, now());
    } catch (error) {
      if (!(error instanceof PayrollLeaseLostError)) throw error;
      const current = await getPool().query(`SELECT * FROM work_payroll_runs WHERE organization_id=$1 AND id=$2`, [scope.organizationId, runId]);
      if (current.rows[0]) return progress(current.rows[0]);
      throw error;
    }
    if (latest.status === "done" || latest.status === "failed" || latest.status === "canceled") return latest;
    if (Date.now() - startedAt >= budgetMs) return latest;
    const state = await runStateKey(scope, runId);
    unchanged = state && state === previous ? unchanged + 1 : 0;
    previous = state;
    if (unchanged >= 1) return latest;
  }
  if (!latest) throw new Error("Payroll run could not be advanced.");
  return latest;
}

export async function advanceDuePayrollRuns(at: Date, limit = 2, options: {
  budgetMs?: number; maxSteps?: number;
} = {}): Promise<PayrollProgress[]> {
  const rows = await getPool().query(`SELECT organization_id, person_id, id FROM work_payroll_runs
    WHERE status IN ('queued','running') AND (lease_until IS NULL OR lease_until <= $1)
      AND cancel_requested_at IS NULL ORDER BY created_at LIMIT $2`, [at.toISOString(), Math.max(1, Math.min(10, limit))]);
  const out: PayrollProgress[] = [];
  for (const row of rows.rows as RunRow[]) {
    const scope = { organizationId: String(row.organization_id), personId: String(row.person_id) };
    try { out.push(await drainPayrollRun(scope, String(row.id), payrollRunDeps(scope), options)); }
    catch (error) { out.push({ phase: "done", message: error instanceof Error ? error.message : "Payroll advance failed.", daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0, remaining: 0, status: "failed", nextAttemptAt: null }); }
  }
  return out;
}

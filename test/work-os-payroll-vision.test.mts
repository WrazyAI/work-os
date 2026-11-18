import assert from "node:assert/strict";
import test from "node:test";
import { payrollFixture, org, person } from "./helpers/work-os-payroll-fixture.mts";
import { WORK_OS_SCREENSHOT_CONSENT_PURPOSE, WORK_OS_TRACKING_POLICY } from "../src/lib/work-os-onboarding";
import { resolvePayrollAiPolicy } from "../src/lib/work-os-ai-model";
import type { PayrollFrameContext } from "../src/modules/work-os/payroll/contracts";

// The break this catches: a timed-out or malformed vision call becoming an idle
// (and therefore potentially unpaid) observation, or a cache key that leaks a
// frame across people/consent epochs.
const vision = () => import("../src/lib/work-os-payroll-vision");
const scope = { organizationId: org, personId: person };
const policy = resolvePayrollAiPolicy({});
const frame = (over: Partial<PayrollFrameContext> = {}): PayrollFrameContext => ({
  scope, summaryId: "80000000-0000-4000-8000-000000000010", evidenceEventId: "80000000-0000-4000-8000-000000000011",
  capturedAt: "2026-11-05T10:00:00.000Z", sourceHash: "source-a", summary: "Editor with a source file open.",
  app: "Editor", findingKey: "finding-1", policyVersion: "v1", ...over,
});

test("selection takes only the first, middle and last representative frames", async () => {
  const { selectPayrollFrames } = await vision();
  const frames = Array.from({ length: 8 }, (_, index) => frame({ summaryId: `80000000-0000-4000-8000-00000000002${index}`, capturedAt: `2026-11-05T1${index}:00:00.000Z` }));
  const selected = selectPayrollFrames({ scope, date: "2026-11-05", week: 1, timezone: "UTC", sessions: [], breaks: [], pauseResidualMs: 0, captures: [], exceptions: [], frameCandidates: frames, blockers: [], sourceHash: "day" });
  assert.deepEqual(selected.map((item) => item.summaryId), [frames[0].summaryId, frames[4].summaryId, frames[7].summaryId]);
  assert.deepEqual(selectPayrollFrames({ scope, date: "2026-11-05", week: 1, timezone: "UTC", sessions: [], breaks: [], pauseResidualMs: 0, captures: [], exceptions: [], frameCandidates: frames.slice(0, 2), blockers: [], sourceHash: "day" }).length, 2);
});

test("cache identity includes source, summary, policy and consent epoch", async () => {
  const { payrollFrameClassificationKey } = await vision();
  const base = payrollFrameClassificationKey(scope, frame(), policy, "consent-a");
  assert.notEqual(base, payrollFrameClassificationKey(scope, frame(), policy, "consent-b"));
  assert.notEqual(base, payrollFrameClassificationKey(scope, frame({ summary: "Different summary." }), policy, "consent-a"));
  assert.notEqual(base, payrollFrameClassificationKey(scope, frame({ sourceHash: "source-b" }), policy, "consent-a"));
  assert.notEqual(base, payrollFrameClassificationKey(scope, frame(), { ...policy, visionModel: "custom/vision" }, "consent-a"));
  assert.notEqual(base, payrollFrameClassificationKey({ ...scope, personId: "20000000-0000-4000-8000-000000000099" }, frame(), policy, "consent-a"));
});

test("timeout, missing arguments and length truncation are unclear, never idle", async () => {
  const { classifyPayrollFrame } = await vision();
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    const loadImage = async () => "data:image/jpeg;base64,AA==";
    const aborted = await classifyPayrollFrame(scope, frame(), policy, AbortSignal.abort(), { loadImage, fetch: async () => { throw new Error("must not be called"); } });
    assert.equal(aborted.category, "unclear");
    assert.equal("minutes" in aborted, false);

    const timedOut = await classifyPayrollFrame(scope, frame(), policy, undefined, {
      loadImage, fetch: async () => { throw new DOMException("timed out", "AbortError"); },
    });
    assert.equal(timedOut.category, "unclear");
    assert.equal(timedOut.confidence, 0);

    const noArgs = await classifyPayrollFrame(scope, frame(), policy, undefined, {
      loadImage, fetch: async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [] } }] }), { status: 200 }),
    });
    assert.equal(noArgs.category, "unclear");

    const length = await classifyPayrollFrame(scope, frame(), policy, undefined, {
      loadImage, fetch: async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { tool_calls: [] } }] }), { status: 200 }),
    });
    assert.equal(length.category, "unclear");

    const success = await classifyPayrollFrame(scope, frame(), policy, undefined, {
      loadImage,
      fetch: async () => new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify({ category: "work", confidence: 0.9, reason: "A source file is visible.", app: "Editor" }) } }] } }] }), { status: 200 }),
    });
    assert.equal(success.category, "work");
    assert.equal(success.confidence, 0.9);
    assert.equal("minutes" in success, false);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("consent is rechecked immediately before an image can be used", async () => {
  const { assertPayrollFrameImageAccess } = await vision();
  const f = await payrollFixture();
  try {
    const summary = "80000000-0000-4000-8000-000000000010";
    await f.db.query(`insert into work_screenshot_summaries(id,organization_id,person_id,processing_status,expires_at,deleted_at)
      values($1,$2,$3,'processed','2027-01-01T00:00:00Z',null)`, [summary, org, person]);
    const accept = async (purpose: string, at: string) => f.db.query(`insert into work_consent_records(organization_id,person_id,purpose,policy_version,decision,occurred_at)
      values($1,$2,$3,$4,'accepted',$5)`, [org, person, purpose, WORK_OS_TRACKING_POLICY.version, at]);
    await accept(WORK_OS_TRACKING_POLICY.purpose, "2026-01-01T00:00:00Z");
    await accept(WORK_OS_SCREENSHOT_CONSENT_PURPOSE, "2026-01-01T00:00:00Z");
    const target = frame({ summaryId: summary });
    await assertPayrollFrameImageAccess(scope, target, new Date("2026-11-16T06:05:00Z"));
    await f.db.query(`insert into work_consent_records(organization_id,person_id,purpose,policy_version,decision,occurred_at)
      values($1,$2,$3,$4,'denied','2026-11-15T00:00:00Z')`, [org, person, WORK_OS_SCREENSHOT_CONSENT_PURPOSE, WORK_OS_TRACKING_POLICY.version]);
    await assert.rejects(assertPayrollFrameImageAccess(scope, target, new Date("2026-11-16T06:05:00Z")), /consent/i);
    await assert.rejects(assertPayrollFrameImageAccess({ organizationId: org, personId: "20000000-0000-4000-8000-000000000099" }, target), /owned/i);
    await assert.rejects(assertPayrollFrameImageAccess(scope, frame({ summaryId: "80000000-0000-4000-8000-000000000099" })), /owned/i);
  } finally { await f.close(); }
});

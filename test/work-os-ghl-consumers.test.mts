import assert from "node:assert/strict";
import test from "node:test";
import { buildEodReportMarkdown, type EodReportFacts } from "../src/lib/work-os-eod-report";
import { intervalSynthesisMessages, parseIntervalSynthesis } from "../src/lib/work-os-activity-intervals";

test("a recap prompt carries the bounded GHL block and provider-sourced allowlist entries", () => {
  const messages = intervalSynthesisMessages({
    windowLabel: "2:00–3:00 PM",
    observations: [],
    images: [],
    counts: { providerFrames: 0, processed: 0, retained: 0, excludedPolicy: 0, excludedSensitive: 0, unavailable: 0, pending: 0, analyzedThisCall: 0 },
    ghlBlock: "Recorded GHL activity (provider facts; ownership is not authorship):\n- [performed by the employee] email sent: Proposal (2026-11-03 18:17)",
  });
  assert.equal(JSON.stringify(messages).includes("Recorded GoHighLevel activity"), true);
  assert.equal(JSON.stringify(messages).includes("Recorded GHL activity"), true);
});

test("a recap keeps a real GHL source id and rejects an invented provider action", () => {
  const parsed = parseIntervalSynthesis({
    headline: "Proposal work",
    detail: "Sent a proposal to a customer and reviewed the thread.",
    activities: [],
    workflow: [],
    uncertainties: [],
    apps: [],
    recorded_activity: [
      { description: "email sent: Proposal", relation: "performed", url: null },
      { description: "closed a $50,000 sale", relation: "performed", url: null },
    ],
    coverage: { first_observed_at: null, last_observed_at: null, analyzed_frames: 0, raw_frames_shown_to_model: 0 },
  }, 0, [{ description: "email sent: Proposal", relation: "performed", url: null, source: "ghl", eventId: "event-1" }]);
  assert.equal(parsed.recordedActivity.length, 1);
  assert.equal(parsed.recordedActivity[0]!.source, "ghl");
  assert.equal(parsed.recordedActivity[0]!.eventId, "event-1");
});

function eodFacts(ghl: EodReportFacts["ghl"]): EodReportFacts {
  return {
    date: "2026-11-03",
    personName: "Sam Adly",
    timezone: "America/New_York",
    roleName: "Account manager",
    goal: { text: "Follow up with prospects", provenance: "employee" },
    session: { clockedInAt: "2026-11-03T13:00:00.000Z", clockedOutAt: "2026-11-03T21:00:00.000Z" },
    completed: [],
    carried: [],
    automation: [],
    automationOutsideLabel: null,
    planItems: [],
    updates: [],
    blockers: [],
    recaps: [],
    hourly: [],
    github: null,
    ghl,
    media: [],
    evidence: [],
  };
}

test("the deterministic EOD reports GHL performed work once and never credits context", () => {
  const report = buildEodReportMarkdown(eodFacts({
    performed: { email: 1, call: 2 },
    context: 3,
    coverage: [{ kind: "appointment", state: "partial" }],
  }));
  assert.match(report.markdown, /GHL, provider-recorded/);
  assert.match(report.markdown, /1 email/);
  assert.match(report.markdown, /2 calls/);
  assert.match(report.markdown, /3 shared, automated, assigned or unknown context items not credited/);
  assert.match(report.markdown, /appointment partial/);
  assert.equal(report.markdown.includes("task complete"), false);
  assert.equal(report.metrics.completed, 0, "provider activity never becomes task completion");
});

test("unavailable GHL coverage is reported even when no activity was counted", () => {
  const report = buildEodReportMarkdown(eodFacts({
    performed: {},
    context: 0,
    coverage: [{ kind: "email", state: "unavailable" }],
  }));
  assert.match(report.markdown, /no attributable activity recorded/);
  assert.match(report.markdown, /email unavailable/);
});

test("no GHL facts means no GHL evidence line", () => {
  const report = buildEodReportMarkdown(eodFacts(null));
  assert.equal(report.markdown.includes("GHL, provider-recorded"), false);
});

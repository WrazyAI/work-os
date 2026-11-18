import assert from "node:assert/strict";
import test from "node:test";
import { resolvePayrollPeriod } from "../src/lib/work-os-payroll-period";
import { resolvePayrollAiPolicy } from "../src/lib/work-os-ai-model";
import type { PayrollSourceManifest, PayrollWeekSources } from "../src/modules/work-os/payroll/contracts";

// The break this catches: a week brief citing the other week's recap, dropping
// the tail of a large source set, or narrating hours as a pay decision.
const briefs = () => import("../src/lib/work-os-payroll-briefs");
const scope = { organizationId: "10000000-0000-4000-8000-000000000001", personId: "20000000-0000-4000-8000-000000000001" };
const period = resolvePayrollPeriod("2026-11-16", "UTC");
const recap = (id: string, date: string, detail = "Worked through the queue and documented the result.") => ({
  id, revision: 1, reviewVersion: 1, reviewSource: "employee" as const, headline: "Queue work", detail,
  date, citations: [{ type: "interval" as const, id, revision: 1 }],
});
const week = (number: 1 | 2, recaps: PayrollWeekSources["recaps"], outcomes: PayrollWeekSources["outcomes"] = []): PayrollWeekSources => ({
  scope, week: number, from: period.weeks[number - 1].from, through: period.weeks[number - 1].through,
  sourceHash: `week-${number}`, recaps, outcomes, gaps: [],
});
const manifest = (weeks: [PayrollWeekSources, PayrollWeekSources]): PayrollSourceManifest => ({
  scope, period, asOf: "2026-11-16T06:05:00.000Z", sourceToken: "0:0", policyVersion: "v1",
  days: [], weekSources: weeks, hash: "manifest-hash",
});
const november = manifest([
  week(1, [recap("nov1", "2026-11-01"), recap("nov7", "2026-11-07")]),
  week(2, [recap("nov8", "2026-11-08")]),
]);
const policy = resolvePayrollAiPolicy({});

const success = (args: Record<string, unknown>) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(args) } }] } }] }),
}) as Response;

test("week_one_contains_only_its_own_recap_sources", async () => {
  const { selectPayrollWeekSources, validatePayrollCitations } = await briefs();
  const weekOne = selectPayrollWeekSources(november, 1);
  assert.deepEqual(weekOne.recaps.map((item) => item.id), ["nov1", "nov7"]);
  assert.deepEqual(validatePayrollCitations([{ type: "interval", id: "nov8", revision: 1 }], weekOne), []);
  assert.deepEqual(validatePayrollCitations([{ type: "interval", id: "nov1", revision: 1 }], weekOne), [{ type: "interval", id: "nov1", revision: 1 }]);
  assert.deepEqual(validatePayrollCitations([{ type: "interval", id: "nov1", revision: 2 }], weekOne), []);
});

test("no-source weeks are exact and never call the model", async () => {
  const { advancePayrollWeekBrief } = await briefs();
  const empty = week(1, []);
  let calls = 0;
  const result = await advancePayrollWeekBrief(scope, empty, policy, null, undefined, {
    fetch: async () => { calls += 1; throw new Error("must not be called"); },
  });
  assert.equal(calls, 0);
  assert.equal(result.brief.summary, "No recaps recorded for these dates");
  assert.equal(result.brief.status, "missing");
  assert.equal(result.complete, true);
});

test("a cited brief is built from only the requested week and cannot carry minutes", async () => {
  const { advancePayrollWeekBrief } = await briefs();
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    const result = await advancePayrollWeekBrief(scope, week(1, [recap("nov1", "2026-11-01")]), policy, null, undefined, {
      fetch: async (_url, init) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages: Array<{ content: string }> };
        assert.match(body.messages.map((message) => message.content).join(" "), /nov1/);
        return success({
          title: "Week 1 progress", summary: "The queue was reviewed and documented.",
          citations: [{ type: "interval", id: "nov1", revision: 1 }],
          themes: [{ heading: "Queue", detail: "Reviewed and documented the queue.", citations: [{ type: "interval", id: "nov1", revision: 1 }] }],
          openItems: [], gaps: [],
        });
      },
    });
    assert.equal(result.complete, true);
    assert.equal(result.brief.status, "ready");
    assert.deepEqual(result.brief.summaryCitations, [{ type: "interval", id: "nov1", revision: 1 }]);
    assert.equal(result.brief.themes.length, 1);
    assert.equal("minutes" in result.brief, false);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("cross-week citations are dropped from the associated claim", async () => {
  const { advancePayrollWeekBrief } = await briefs();
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    const result = await advancePayrollWeekBrief(scope, week(1, [recap("nov1", "2026-11-01")]), policy, null, undefined, {
      fetch: async () => success({
        title: "Week 1", summary: "A claim from another week.",
        citations: [{ type: "interval", id: "nov8", revision: 1 }],
        themes: [{ heading: "Own", detail: "This week's source.", citations: [{ type: "interval", id: "nov1", revision: 1 }] }],
        openItems: [], gaps: [],
      }),
    });
    assert.equal(result.brief.status, "failed");
    assert.equal(result.brief.summary, "");
    assert.equal(result.brief.themes.length, 0);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("completion language requires a recorded outcome source", async () => {
  const { advancePayrollWeekBrief } = await briefs();
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    const result = await advancePayrollWeekBrief(scope, week(1, [recap("nov1", "2026-11-01")]), policy, null, undefined, {
      fetch: async () => success({
        title: "Week 1", summary: "Completed the queue.", citations: [{ type: "interval", id: "nov1", revision: 1 }],
        themes: [], openItems: [], gaps: [],
      }),
    });
    assert.equal(result.brief.status, "failed");
    assert.equal(result.brief.summary, "");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("a provider failure leaves an optional failed brief without throwing", async () => {
  const { advancePayrollWeekBrief } = await briefs();
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    const result = await advancePayrollWeekBrief(scope, week(1, [recap("nov1", "2026-11-01")]), policy, null, undefined, {
      fetch: async () => { throw new Error("provider down"); },
    });
    assert.equal(result.brief.status, "failed");
    assert.equal(result.complete, false);
    assert.match(result.brief.gaps[0], /provider down/i);
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

test("300 recaps are batched without truncation and combine into one brief", async () => {
  const { advancePayrollWeekBrief } = await briefs();
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  try {
    const recaps = Array.from({ length: 300 }, (_, index) => recap(`r${index}`, `2026-11-0${1 + (index % 6)}`, `Detail ${index}`));
    const sources = week(1, recaps);
    let checkpoint: Awaited<ReturnType<typeof advancePayrollWeekBrief>>["checkpoint"] | null = null;
    let result: Awaited<ReturnType<typeof advancePayrollWeekBrief>> | null = null;
    for (let call = 0; call < 20; call += 1) {
      result = await advancePayrollWeekBrief(scope, sources, policy, checkpoint, undefined, {
        fetch: async (_url, init) => {
          const text = String(init?.body ?? "");
          const match = /\[interval:([^@\]]+)@(\d+)\]/.exec(text);
          assert.ok(match, "each batch includes a source");
          const citation = { type: "interval", id: match[1], revision: Number(match[2]) };
          return success({ title: "Week 1", summary: "Reviewed the supplied work.", citations: [citation], themes: [{ heading: "Work", detail: "Recorded work.", citations: [citation] }], openItems: [], gaps: [] });
        },
      });
      checkpoint = result.checkpoint;
      if (result.complete) break;
    }
    assert.ok(result?.complete);
    assert.equal(checkpoint?.drafts.length, 10);
    assert.equal(checkpoint?.phase, "done");
    assert.equal(result?.brief.status, "ready");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});

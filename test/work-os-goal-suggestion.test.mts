import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildGoalSuggestionPrompt, MAX_GOAL_CHARS, parseGoalSuggestion } from "../src/lib/work-os-goal-suggestion";

const context = {
  date: "2026-10-20",
  priorOpen: ["Reconcile the September settlement", "Send the provider export"],
  createdToday: ["Draft the onboarding note"],
  dueToday: ["Review the intake queue"],
  activity: ["VS Code — an editor shows the settlement reconciliation test", "Chrome — a pull request page"],
};

test("the suggestion prompt carries only the bounded work and activity context", () => {
  const prompt = buildGoalSuggestionPrompt(context);
  assert.match(prompt, /one short sentence/i);
  assert.match(prompt, /Unfinished work from earlier days:/);
  assert.match(prompt, /Reconcile the September settlement/);
  assert.match(prompt, /Work created or due today:/);
  assert.match(prompt, /Draft the onboarding note/);
  assert.match(prompt, /Review the intake queue/);
  assert.match(prompt, /Observed activity in this interval:/);
  assert.match(prompt, /settlement reconciliation test/);
  assert.match(prompt, /Do not claim completion, effort, or quality/);
  assert.match(prompt, /Return only JSON/);
  // The prompt never asks the model to act on the workspace.
  assert.doesNotMatch(prompt, /complete the task/i);
});

test("the suggestion prompt states an empty source instead of inventing one", () => {
  const prompt = buildGoalSuggestionPrompt({ date: "2026-10-20", priorOpen: [], createdToday: [], dueToday: [], activity: [] });
  assert.equal(prompt.match(/- None recorded\./g)?.length, 3);
});

test("a suggested goal is one trimmed, bounded sentence", () => {
  assert.equal(parseGoalSuggestion({ goal: "  Finish the settlement reconciliation, then the intake review.  " }), "Finish the settlement reconciliation, then the intake review.");
  assert.equal(parseGoalSuggestion({ goal: "Line one.\nLine two." }), "Line one. Line two.");
  assert.equal(parseGoalSuggestion({ goal: "x".repeat(400) })?.length, MAX_GOAL_CHARS);
  assert.equal(parseGoalSuggestion({ goal: "   " }), null);
  assert.equal(parseGoalSuggestion({ goal: 42 }), null);
  assert.equal(parseGoalSuggestion(null), null);
  assert.equal(parseGoalSuggestion({}), null);
});

/** Isolate import-time model selection, and replace only external persistence
 * and provider boundaries. The actual suggestion orchestration still runs. */
function runSuggestion(env: Record<string, string> = {}, outcome = "success") {
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("WORK_OS_") || key.startsWith("OPENROUTER_") || key.startsWith("DATABASE_URL") || key === "MIGRATION_DATABASE_URL") delete childEnv[key];
  }
  const output = execFileSync(process.execPath, ["--import", "tsx", "-e", `
    const calls = [], writes = [], audits = [], filters = [], usage = [];
    const outcome = ${JSON.stringify(outcome)};
    const internalPath = require.resolve('./src/lib/work-os-internal.ts');
    const internal = require(internalPath);
    require.cache[internalPath].exports = { ...internal,
      db: () => ({ from: table => {
        if (table !== 'work_daily_plans') throw new Error('Unexpected table: ' + table);
        let writing = false;
        const query = {
          select() { return query; },
          eq(...args) { if (writing) filters.push(['eq', ...args]); return query; },
          is(...args) { if (writing) filters.push(['is', ...args]); return query; },
          update(value) { writing = true; writes.push(value); return query; },
          async maybeSingle() { return { error: null, data: writing ? (outcome === 'race' ? null : {id:'plan-1'}) : {id:'plan-1',focus_summary:null,freeform_intent:null} }; },
        };
        return query;
      }}),
      audit: async (...args) => { audits.push(args); },
    };
    const workPath = require.resolve('./src/lib/work-os.ts');
    require(workPath);
    require.cache[workPath].exports = { listPersonTasks: async () => [{id:'task-1',title:'Review the intake queue',due_date:'2026-10-20',created_at:'2026-10-20'}] };
    globalThis.fetch = async (url, init) => {
      calls.push({url, body:JSON.parse(init.body), timeout:!!init.signal});
      if (outcome === 'throw') throw new Error('provider unavailable');
      if (outcome === 'failure') return new Response('unavailable', {status:503});
      return new Response(JSON.stringify({choices:[{message:{content:outcome === 'malformed' ? 'not JSON' : JSON.stringify({goal:'Review the intake queue.'})}}],usage:{prompt_tokens:30,completion_tokens:12}}));
    };
    const originalInfo = console.info;
    console.info = (...args) => { usage.push(args.join(' ')); };
    const {suggestWorkOsDayGoal} = require('./src/lib/work-os-goal-suggestion.ts');
    suggestWorkOsDayGoal({personId:'person-1',organizationId:'org-1',organizationOwnerId:'owner-1'}, {date:'2026-10-20'})
      .then(result => { console.info = originalInfo; console.log(JSON.stringify({result,calls,writes,audits,filters,usage})); })
      .catch(error => { console.error(error); process.exitCode=1; });
  `], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...childEnv, OPENROUTER_API_KEY: "test-key", OPENROUTER_BASE_URL: "https://provider.invalid/chat/completions", ...env },
    encoding: "utf8",
  });
  return JSON.parse(output.trim().split("\n").at(-1)!);
}

test("a configured DeepSeek goal request honors the Morph pin and reasoning policy", () => {
  const result = runSuggestion({
    WORK_OS_GOAL_SUGGESTION_MODEL: "deepseek/deepseek-v4.1-flash-1017",
    WORK_OS_AI_PROVIDER_ONLY: "morph", WORK_OS_AI_ALLOW_FALLBACKS: "false",
  });
  const body = result.calls[0].body;
  assert.deepEqual(body.provider, {only:["morph"],allow_fallbacks:false,require_parameters:true});
  assert.deepEqual(body.reasoning, {effort:"low"});
  assert.equal(body.model, "deepseek/deepseek-v4.1-flash-1017");
  assert.ok(body.max_tokens >= 1_000 && body.max_tokens <= 2_000);
  assert.deepEqual(body.response_format, {type:"json_object"});
  assert.equal(result.calls[0].url, "https://provider.invalid/chat/completions");
  assert.equal(result.calls[0].timeout, true);
  assert.deepEqual(result.result, {goal:"Review the intake queue.",taskIds:["task-1"]});
  assert.equal(result.writes[0].goal_provenance, "suggested");
  assert.deepEqual(result.filters, [
    ["eq","organization_id","org-1"], ["eq","id","plan-1"],
    ["is","focus_summary",null], ["is","freeform_intent",null],
  ]);
  assert.equal(result.audits.length, 1);
  assert.ok(result.usage.some((line: string) => line.includes('"surface":"goal_suggestion"') && line.includes('"completionTokens":12')));
});

test("the legacy goal default remains unrestricted with its 200-token budget", () => {
  const result = runSuggestion({WORK_OS_AI_PROVIDER_ONLY:"morph",WORK_OS_AI_ALLOW_FALLBACKS:"false"});
  const body = result.calls[0].body;
  assert.equal(body.model, "gpt-5.6-luna");
  assert.equal(body.provider, undefined);
  assert.equal(body.reasoning, undefined);
  assert.equal(body.max_tokens, 200);
  assert.ok(result.usage.some((line: string) => line.includes('"surface":"goal_suggestion"')));
});

test("goal requests honor explicit shared reasoning disablement", () => {
  const result = runSuggestion({WORK_OS_GOAL_SUGGESTION_MODEL:"deepseek/deepseek-v4.1-flash-1017",WORK_OS_AI_REASONING_EFFORT:"none"});
  assert.deepEqual(result.calls[0].body.reasoning, {enabled:false});
});

test("provider failure or malformed output never writes a goal or audit", () => {
  for (const outcome of ["failure", "throw", "malformed"]) {
    const result = runSuggestion({}, outcome);
    assert.equal(result.result, null, outcome);
    assert.equal(result.calls.length, 1, outcome);
    assert.deepEqual(result.writes, [], outcome);
    assert.deepEqual(result.audits, [], outcome);
  }
});

test("a concurrent employee goal keeps the conditional write from recording a suggestion", () => {
  const result = runSuggestion({}, "race");
  assert.equal(result.result, null);
  assert.deepEqual(result.audits, []);
  assert.deepEqual(result.filters.slice(-2), [["is","focus_summary",null],["is","freeform_intent",null]]);
});

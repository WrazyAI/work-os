import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  AI_TIMEOUTS,
  AI_TOKEN_BUDGETS,
  DEEPSEEK_MODEL,
  SCREENSHOT_PERCEPTION_MODEL,
  aiRequestBody,
  providerRoute,
  reasoningControl,
  recordAiUsage,
  resolveAiModels,
} from "../src/lib/work-os-ai-model";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

/** Every library that talks to the model provider. */
const AI_LIBRARIES = [
  "src/lib/aiInterpret.ts",
  "src/lib/aiPlan.ts",
  "src/lib/aiEod.ts",
  "src/lib/aiInsights.ts",
  "src/lib/aiLoom.ts",
  "src/lib/work-memory-facts.ts",
  "src/lib/work-os-next-steps.ts",
  "src/lib/work-os-screenshots.ts",
  "src/lib/work-os-screenshot-hours.ts",
  "src/lib/work-os-activity-intervals.ts",
  "src/lib/work-os-checkins.ts",
];

test("every provider call routes through the shared model and provider policy", async () => {
  for (const library of AI_LIBRARIES) {
    const text = await source(library);
    const calls = text.match(/fetch\(OPENROUTER_URL|fetch\(url,/g) ?? [];
    const routed = text.match(/aiRequestBody\(/g) ?? [];
    assert.ok(calls.length > 0, `${library} makes no provider call to guard`);
    assert.equal(
      routed.length,
      calls.length,
      `${library} has a provider call that does not go through aiRequestBody`,
    );
    // A hard-coded model would bypass the routing table and the pin.
    assert.doesNotMatch(
      text,
      /model:\s*["'](gpt-|deepseek|openai\/)/,
      `${library} hard-codes a model slug instead of using the shared policy`,
    );
  }
});

test("the model policy is the only place a model slug is named", async () => {
  const policy = await source("src/lib/work-os-ai-model.ts");
  assert.match(policy, /deepseek\/deepseek-v4\.1-flash-1017/);
  assert.match(policy, /openai\/gpt-6-luna/);
});

test("the synthesis model is pinned to Relace with fallbacks disabled", () => {
  assert.deepEqual(providerRoute(DEEPSEEK_MODEL), { only: ["relace"], allow_fallbacks: false });
});

test("an unpinned model carries no provider routing", () => {
  assert.equal(providerRoute(SCREENSHOT_PERCEPTION_MODEL), undefined);
  assert.equal(providerRoute("openai/gpt-5.6-luna"), undefined);
});

test("the request body carries the pin only for pinned models", () => {
  const pinned = aiRequestBody(DEEPSEEK_MODEL, { temperature: 0.2 });
  assert.equal(pinned.model, DEEPSEEK_MODEL);
  assert.deepEqual(pinned.provider, {
    only: ["relace"],
    allow_fallbacks: false,
    require_parameters: true,
  });
  assert.equal(pinned.temperature, 0.2);

  const unpinned = aiRequestBody(SCREENSHOT_PERCEPTION_MODEL, { max_tokens: 2000 });
  assert.equal(unpinned.model, SCREENSHOT_PERCEPTION_MODEL);
  assert.equal(unpinned.provider, undefined);
  assert.equal(unpinned.max_tokens, 2000);
});

test("the request body always names the model it was given", () => {
  const body = aiRequestBody(DEEPSEEK_MODEL, { model: "some-other/model" });
  assert.equal(body.model, DEEPSEEK_MODEL);
});

test("the reasoning model thinks before it answers, within a bounded effort", () => {
  assert.deepEqual(reasoningControl(DEEPSEEK_MODEL), { effort: "low" });
  // The provider ignores a reasoning token cap, so the effort level is the
  // only lever that bounds the reasoning pass.
  assert.deepEqual(reasoningControl(DEEPSEEK_MODEL, { WORK_OS_AI_REASONING_EFFORT: "high" }), { effort: "high" });
  assert.deepEqual(reasoningControl(DEEPSEEK_MODEL, { WORK_OS_AI_REASONING_EFFORT: "none" }), { enabled: false });
  assert.deepEqual(reasoningControl(DEEPSEEK_MODEL, { WORK_OS_AI_REASONING_EFFORT: "nonsense" }), { effort: "low" });
});

test("a model that does not reason is not given a reasoning control", () => {
  assert.equal(reasoningControl(SCREENSHOT_PERCEPTION_MODEL), undefined);
  assert.equal(aiRequestBody(SCREENSHOT_PERCEPTION_MODEL, {}).reasoning, undefined);
});

test("the request body carries the reasoning control for the reasoning model", () => {
  const body = aiRequestBody(DEEPSEEK_MODEL, { temperature: 0.2 });
  assert.deepEqual(body.reasoning, { effort: "low" });
  assert.deepEqual(
    aiRequestBody(DEEPSEEK_MODEL, {}, { WORK_OS_AI_REASONING_EFFORT: "none" }).reasoning,
    { enabled: false },
  );
});

test("an operator can repoint the pin or re-enable fallbacks", () => {
  assert.deepEqual(providerRoute(DEEPSEEK_MODEL, { WORK_OS_AI_PROVIDER_ONLY: "relace,morph" }), {
    only: ["relace", "morph"],
    allow_fallbacks: false,
  });
  assert.deepEqual(providerRoute(DEEPSEEK_MODEL, { WORK_OS_AI_ALLOW_FALLBACKS: "true" }), {
    only: ["relace"],
    allow_fallbacks: true,
  });
  assert.deepEqual(providerRoute(DEEPSEEK_MODEL, { WORK_OS_AI_ALLOW_FALLBACKS: "0" }), {
    only: ["relace"],
    allow_fallbacks: false,
  });
});

test("the provider override never reaches an unpinned model", () => {
  assert.equal(providerRoute(SCREENSHOT_PERCEPTION_MODEL, { WORK_OS_AI_PROVIDER_ONLY: "relace" }), undefined);
});

test("summaries and recaps run on the synthesis model, screenshots on the vision model", () => {
  const models = resolveAiModels({});
  assert.equal(models.interpret, DEEPSEEK_MODEL);
  assert.equal(models.plan, DEEPSEEK_MODEL);
  assert.equal(models.eod, DEEPSEEK_MODEL);
  assert.equal(models.insights, DEEPSEEK_MODEL);
  assert.equal(models.loom, DEEPSEEK_MODEL);
  assert.equal(models.memoryFact, DEEPSEEK_MODEL);
  assert.equal(models.nextSteps, DEEPSEEK_MODEL);
  assert.equal(models.activityInterval, DEEPSEEK_MODEL);
  assert.equal(models.screenshotHour, DEEPSEEK_MODEL);
  assert.equal(models.checkIn, DEEPSEEK_MODEL);
  assert.equal(models.screenshot, SCREENSHOT_PERCEPTION_MODEL);
});

test("a recap never inherits the screenshot model", () => {
  const models = resolveAiModels({ WORK_OS_SCREENSHOT_MODEL: "openai/gpt-6-luna" });
  assert.equal(models.screenshot, "openai/gpt-6-luna");
  assert.equal(models.activityInterval, DEEPSEEK_MODEL);
  assert.equal(models.nextSteps, DEEPSEEK_MODEL);
});

test("a deployment-wide override still reaches the synthesis surfaces", () => {
  const models = resolveAiModels({ WORK_OS_INTERPRET_MODEL: "openai/gpt-5.6-luna" });
  assert.equal(models.interpret, "openai/gpt-5.6-luna");
  assert.equal(models.eod, "openai/gpt-5.6-luna");
  assert.equal(models.activityInterval, "openai/gpt-5.6-luna");
  assert.equal(models.screenshot, "openai/gpt-5.6-luna");
});

test("a surface-specific override beats the deployment-wide one", () => {
  const models = resolveAiModels({
    WORK_OS_INTERPRET_MODEL: "openai/gpt-5.6-luna",
    WORK_OS_SCREENSHOT_MODEL: "openai/gpt-6-luna",
  });
  assert.equal(models.screenshot, "openai/gpt-6-luna");
  assert.equal(models.interpret, "openai/gpt-5.6-luna");
});

test("an overridden model that is not pinned carries no provider routing", () => {
  const models = resolveAiModels({ WORK_OS_INTERPRET_MODEL: "openai/gpt-5.6-luna" });
  assert.equal(providerRoute(models.interpret), undefined);
  assert.equal(providerRoute(models.activityInterval), undefined);
});

test("every completion budget leaves room for the reasoning pass", () => {
  // The synthesis model reasons before it answers and those reasoning tokens
  // come out of the same budget, so a budget below the reasoning floor can
  // truncate a structured answer mid-JSON.
  const reasoningFloor = 1_000;
  for (const [surface, budget] of Object.entries(AI_TOKEN_BUDGETS)) {
    assert.ok(budget > reasoningFloor, `${surface} budget ${budget} leaves no reasoning headroom`);
  }
});

test("every surface timeout outlasts the budget it can spend", () => {
  // A timeout that is tighter than the generation it waits on turns a slow
  // answer into a failed one, so each surface must be able to spend its
  // whole budget before it is cut off.
  const worstCaseMs = 250;
  for (const [surface, timeout] of Object.entries(AI_TIMEOUTS)) {
    assert.ok(timeout >= 15_000, `${surface} timeout ${timeout} is too tight to be useful`);
    assert.ok(
      timeout > worstCaseMs * 20,
      `${surface} timeout ${timeout} cannot cover a full completion`,
    );
  }
});

test("usage reports the cached share of the prompt", () => {
  const usage = recordAiUsage("interpret", "deepseek/deepseek-v4.1-flash-1017", {
    usage: {
      prompt_tokens: 9655,
      prompt_tokens_details: { cached_tokens: 8935 },
      completion_tokens: 180,
    },
  });
  assert.deepEqual(usage, { promptTokens: 9655, cachedPromptTokens: 8935, completionTokens: 180 });
});

test("usage degrades to zeros instead of NaN when the provider reports none", () => {
  assert.deepEqual(recordAiUsage("interpret", "m", {}), { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 });
  assert.deepEqual(recordAiUsage("interpret", "m", null), { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 });
  assert.deepEqual(
    recordAiUsage("interpret", "m", { usage: { prompt_tokens: "nonsense" } }),
    { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 },
  );
});

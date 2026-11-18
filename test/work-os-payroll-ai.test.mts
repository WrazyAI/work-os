import assert from "node:assert/strict";
import test from "node:test";
import {
  AI_TIMEOUTS, AI_TOKEN_BUDGETS, DEEPSEEK_MODEL, SCREENSHOT_PERCEPTION_MODEL,
  aiRequestBody, providerRoute, reasoningControl, resolveAiModels, resolvePayrollAiPolicy,
} from "../src/lib/work-os-ai-model";
import { payrollTextRequestBody, payrollVisionRequestBody } from "../src/lib/work-os-payroll-ai";

// The break this catches: payroll's high effort leaking into every surface, or
// an explicit high request being silently overwritten by the global low default.
test("payroll_high_does_not_change_other_surfaces", () => {
  const policy = resolvePayrollAiPolicy({});
  assert.equal(policy.effort, "high");
  assert.equal(policy.textModel, DEEPSEEK_MODEL);
  assert.equal(policy.visionModel, SCREENSHOT_PERCEPTION_MODEL);
  assert.deepEqual(reasoningControl(DEEPSEEK_MODEL, {}), { effort: "low" });
  const payroll = payrollTextRequestBody(policy, "synthesis", { messages: [] }, {});
  assert.deepEqual(payroll.reasoning, { effort: "high" });
  assert.equal(payroll.model, DEEPSEEK_MODEL);
  const ordinary = aiRequestBody(DEEPSEEK_MODEL, { messages: [] }, {});
  assert.deepEqual(ordinary.reasoning, { effort: "low" });
  const models = resolveAiModels({});
  assert.equal(models.plan, DEEPSEEK_MODEL);
  assert.equal(models.activityInterval, DEEPSEEK_MODEL);
});

test("payroll text preserves its high effort and per-surface budgets", () => {
  const policy = resolvePayrollAiPolicy({});
  assert.equal(payrollTextRequestBody(policy, "synthesis", {}, {}).max_tokens, AI_TOKEN_BUDGETS.payrollSynthesis);
  assert.equal(payrollTextRequestBody(policy, "brief", {}, {}).max_tokens, AI_TOKEN_BUDGETS.payrollBrief);
  assert.equal(payrollTextRequestBody(policy, "question", {}, {}).max_tokens, AI_TOKEN_BUDGETS.payrollQuestion);
  assert.deepEqual(payrollVisionRequestBody(policy, {}, {}).reasoning, undefined);
  assert.equal(payrollVisionRequestBody(policy, {}, {}).max_tokens, AI_TOKEN_BUDGETS.payrollVision);
  assert.equal(AI_TIMEOUTS.payrollSynthesis, 120_000);
  assert.equal(AI_TIMEOUTS.payrollVision, 30_000);
});

test("a model switch does not inherit another model's provider pin", () => {
  assert.equal(providerRoute(SCREENSHOT_PERCEPTION_MODEL, {}), undefined);
  assert.equal(providerRoute("custom/unpinned-model", {}), undefined);
  assert.deepEqual(providerRoute(DEEPSEEK_MODEL, {}), { only: ["relace"], allow_fallbacks: false });
  const switched = resolvePayrollAiPolicy({ WORK_OS_PAYROLL_VISION_MODEL: "custom/vision-model" });
  assert.equal(switched.visionModel, "custom/vision-model");
  assert.equal(providerRoute(switched.visionModel, {}), undefined);
});

test("unsupported max and unknown effort fail loudly", () => {
  assert.throws(() => resolvePayrollAiPolicy({ WORK_OS_PAYROLL_REASONING_EFFORT: "max" }), /verified max/i);
  assert.throws(() => resolvePayrollAiPolicy({ WORK_OS_PAYROLL_REASONING_EFFORT: "max", WORK_OS_PAYROLL_MAX_VERIFIED: "1" }), /verified max/i);
  assert.throws(() => resolvePayrollAiPolicy({ WORK_OS_PAYROLL_REASONING_EFFORT: "turbo" }), /high or max/i);
});

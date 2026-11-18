import {
  AI_TOKEN_BUDGETS, AI_TIMEOUTS, aiRequestBody, resolvePayrollAiPolicy,
  type AiEnvironment, type PayrollAiPolicy,
} from "@/lib/work-os-ai-model";

export { resolvePayrollAiPolicy, type PayrollAiPolicy };

/** Payroll text calls always carry the scoped effort explicitly; the registry
 * preserves it instead of applying the global low default. */
export function payrollTextRequestBody(
  policy: PayrollAiPolicy,
  surface: "synthesis" | "brief" | "question",
  body: Record<string, unknown>,
  env: AiEnvironment = process.env,
): Record<string, unknown> {
  const budget = surface === "brief" ? AI_TOKEN_BUDGETS.payrollBrief
    : surface === "question" ? AI_TOKEN_BUDGETS.payrollQuestion
      : AI_TOKEN_BUDGETS.payrollSynthesis;
  return aiRequestBody(policy.textModel, {
    max_tokens: budget,
    reasoning: { effort: policy.effort },
    ...body,
  }, env);
}

export function payrollVisionRequestBody(
  policy: PayrollAiPolicy,
  body: Record<string, unknown>,
  env: AiEnvironment = process.env,
): Record<string, unknown> {
  return aiRequestBody(policy.visionModel, { max_tokens: AI_TOKEN_BUDGETS.payrollVision, ...body }, env);
}

export const PAYROLL_AI_DEADLINES = {
  synthesis: AI_TIMEOUTS.payrollSynthesis,
  brief: AI_TIMEOUTS.payrollBrief,
  question: AI_TIMEOUTS.payrollQuestion,
  vision: AI_TIMEOUTS.payrollVision,
} as const;

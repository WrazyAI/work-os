/**
 * The Work OS AI surface map: which model answers each surface, how OpenRouter
 * is asked to route it, and how much completion budget the surface gets.
 *
 * Two models are in play, split by what each surface actually has to do.
 *
 *  - DeepSeek V4.1 Flash does synthesis. Recaps, summaries, extraction and
 *    proposals all have to weigh evidence, decide what the evidence actually
 *    supports, and return a schema-conformant answer. That is a reasoning
 *    job, so the model reasons before it answers.
 *  - gpt-6-luna does per-frame screenshot perception. The job there is narrow
 *    and visual: describe what is visibly on screen, state uncertainty, and
 *    invent nothing. It is also the cheaper of the two per frame.
 *
 * Routing is pinned per model. A DeepSeek request may only run on Relace and
 * must not fall back to another provider: a fallback would hand the same
 * payload to a different vendor, and the answer would no longer be the one
 * this deployment asked for. `require_parameters` keeps the same promise for
 * parameters — if the pinned provider cannot serve the request as written,
 * the request fails loudly instead of quietly losing its structured-output
 * contract and returning prose the surface cannot parse.
 */

/** Synthesis model. Pinned to Relace; see `providerRoute`. */
export const DEEPSEEK_MODEL = "deepseek/deepseek-v4.1-flash-1017";

/** Per-frame screenshot perception model. Routed normally by OpenRouter. */
export const SCREENSHOT_PERCEPTION_MODEL = "openai/gpt-6-luna";

/** The only provider allowed to serve the synthesis model. */
const RELACE_PROVIDER = "relace";

/**
 * Models whose requests may only run on one provider. A model that is absent
 * here is routed normally, so a surface can be pointed at a different model
 * without inheriting a pin that the new model cannot serve.
 */
const PINNED_ROUTES: Record<string, { only: string[]; allow_fallbacks: boolean }> = {
  [DEEPSEEK_MODEL]: { only: [RELACE_PROVIDER], allow_fallbacks: false },
};

/** Models that think before they answer, and so need a bounded effort. */
const REASONING_MODELS = new Set<string>([DEEPSEEK_MODEL]);

/** The reasoning effort the synthesis model is given. */
const DEFAULT_REASONING_EFFORT = "low";

/** Reads the first environment variable that carries a model slug. */
function envModel(env: NodeJS.ProcessEnv, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

function envFlag(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return undefined;
  return !["0", "false", "off", "no"].includes(raw);
}

/**
 * The provider routing for a model, or undefined when the model is not pinned.
 *
 * `WORK_OS_AI_PROVIDER_ONLY` replaces the pinned provider list and
 * `WORK_OS_AI_ALLOW_FALLBACKS` re-enables fallback providers. Both only apply
 * to models that are already pinned, so an operator cannot accidentally send a
 * model to a provider that does not serve it.
 */
export function providerRoute(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): { only: string[]; allow_fallbacks: boolean } | undefined {
  const pinned = PINNED_ROUTES[model];
  if (!pinned) return undefined;
  const override = (env.WORK_OS_AI_PROVIDER_ONLY ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowFallbacks = envFlag(env, "WORK_OS_AI_ALLOW_FALLBACKS") ?? pinned.allow_fallbacks;
  return { only: override.length ? override : pinned.only, allow_fallbacks: allowFallbacks };
}

/** Reasoning effort levels the provider accepts. */
const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high"]);

/**
 * How much the model is allowed to think before it answers.
 *
 * The synthesis model reasons before it answers, and the reasoning tokens come
 * out of the same completion budget as the answer. Left unbounded, the
 * reasoning pass can spend the whole budget: measured on a twelve-task plan,
 * the default effort spent 2,718 of 3,000 tokens on reasoning and returned an
 * empty body, which the surface can only report as a malformed model
 * response.
 *
 * The provider ignores a reasoning token cap, so the effort level is the only
 * lever that bounds it. "low" keeps the model reasoning — it is not disabled
 * — while keeping the answer inside its budget. `WORK_OS_AI_REASONING_EFFORT`
 * overrides the level, and setting it to "none" turns reasoning off.
 */
export function reasoningControl(
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): { effort: string } | { enabled: false } | undefined {
  if (!REASONING_MODELS.has(model)) return undefined;
  const raw = (env.WORK_OS_AI_REASONING_EFFORT ?? DEFAULT_REASONING_EFFORT).trim().toLowerCase();
  if (!raw || ["none", "off", "0", "false"].includes(raw)) return { enabled: false };
  if (!REASONING_EFFORTS.has(raw)) return { effort: DEFAULT_REASONING_EFFORT };
  return { effort: raw };
}

/**
 * Builds an OpenRouter chat request body for a model. The model is always set
 * here so a call site cannot send a body that names a different model than
 * the one whose route it was given.
 */
export function aiRequestBody(
  model: string,
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> {
  const route = providerRoute(model, env);
  const reasoning = reasoningControl(model, env);
  return {
    ...body,
    model,
    ...(route ? { provider: { ...route, require_parameters: true } } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Per-surface models                                                  */
/* ------------------------------------------------------------------ */

/** The model behind every Work OS AI surface. */
export type AiModelMap = {
  interpret: string;
  plan: string;
  eod: string;
  insights: string;
  loom: string;
  memoryFact: string;
  nextSteps: string;
  activityInterval: string;
  screenshotHour: string;
  checkIn: string;
  screenshot: string;
};

/**
 * Resolves the model behind each surface from the deployment environment.
 *
 * `WORK_OS_INTERPRET_MODEL` stays the deployment-wide override for the
 * synthesis surfaces, as it was before. A surface with its own variable wins
 * over it, so one surface can be moved without touching the rest.
 */
export function resolveAiModels(env: NodeJS.ProcessEnv = process.env): AiModelMap {
  return {
    interpret: envModel(env, "WORK_OS_INTERPRET_MODEL") ?? DEEPSEEK_MODEL,
    plan: envModel(env, "WORK_OS_PLAN_MODEL", "WORK_OS_INTERPRET_MODEL") ?? DEEPSEEK_MODEL,
    eod: envModel(env, "WORK_OS_INTERPRET_MODEL") ?? DEEPSEEK_MODEL,
    insights: envModel(env, "WORK_OS_INTERPRET_MODEL") ?? DEEPSEEK_MODEL,
    loom: envModel(env, "WORK_OS_INTERPRET_MODEL") ?? DEEPSEEK_MODEL,
    memoryFact: envModel(env, "WORK_OS_INTERPRET_MODEL") ?? DEEPSEEK_MODEL,
    nextSteps:
      envModel(env, "WORK_OS_NEXT_STEPS_MODEL", "WORK_OS_ACTIVITY_INTERVAL_MODEL", "WORK_OS_INTERPRET_MODEL") ??
      DEEPSEEK_MODEL,
    // A recap reasons over screenshots that were already perceived, so it is a
    // summary and never inherits the screenshot model.
    activityInterval: envModel(env, "WORK_OS_ACTIVITY_INTERVAL_MODEL", "WORK_OS_INTERPRET_MODEL") ?? DEEPSEEK_MODEL,
    screenshotHour: envModel(env, "WORK_OS_INTERPRET_MODEL") ?? DEEPSEEK_MODEL,
    checkIn: envModel(env, "WORK_OS_AI_MODEL") ?? DEEPSEEK_MODEL,
    screenshot: envModel(env, "WORK_OS_SCREENSHOT_MODEL", "WORK_OS_INTERPRET_MODEL") ?? SCREENSHOT_PERCEPTION_MODEL,
  };
}

const MODELS = resolveAiModels();

export const INTERPRET_MODEL = MODELS.interpret;
export const PLAN_MODEL = MODELS.plan;
export const EOD_MODEL = MODELS.eod;
export const INSIGHTS_MODEL = MODELS.insights;
export const LOOM_MODEL = MODELS.loom;
export const MEMORY_FACT_MODEL = MODELS.memoryFact;
export const NEXT_STEPS_MODEL = MODELS.nextSteps;
export const ACTIVITY_INTERVAL_MODEL = MODELS.activityInterval;
export const SCREENSHOT_HOUR_MODEL = MODELS.screenshotHour;
export const CHECK_IN_MODEL = MODELS.checkIn;
export const SCREENSHOT_MODEL = MODELS.screenshot;

/* ------------------------------------------------------------------ */
/* Completion budgets                                                  */
/* ------------------------------------------------------------------ */

/**
 * Completion budgets, in tokens.
 *
 * The synthesis model reasons before it answers and those reasoning tokens
 * come out of the same budget as the answer, so a budget sized for the answer
 * alone truncates a long answer mid-JSON — which the surface can only report
 * as a malformed model response. The budgets below leave room for a full
 * reasoning pass plus the answer. They are ceilings, not reservations: the
 * model stops when it is done, and the request cost is a fraction of a cent.
 */
export const AI_TOKEN_BUDGETS = {
  interpret: 8_000,
  plan: 8_000,
  eodSelection: 6_000,
  eodRevision: 6_000,
  insights: 4_000,
  loom: 4_000,
  memoryFact: 3_000,
  nextSteps: 4_000,
  activityInterval: 6_000,
  screenshotHour: 4_000,
  screenshotVision: 2_000,
  checkIn: 4_000,
} as const;

/**
 * Request timeouts, in milliseconds.
 *
 * The synthesis model reasons before it answers, so it is slower than the
 * model it replaced. A timeout that is too tight turns a slow answer into a
 * failed one, so each surface is given room for the reasoning pass and the
 * answer it produces.
 */
export const AI_TIMEOUTS = {
  interpret: 60_000,
  plan: 90_000,
  eod: 60_000,
  insights: 60_000,
  loom: 60_000,
  memoryFact: 60_000,
  nextSteps: 60_000,
  activityInterval: 60_000,
  screenshotHour: 60_000,
  screenshotVision: 30_000,
  checkIn: 60_000,
} as const;

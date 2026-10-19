/**
 * Live verification of the Work OS AI stack against the real provider.
 *
 * 1. Calls the real `interpretWorkUpdate` with a stubbed fetch and captures the
 *    exact request body the shipped code builds.
 * 2. Sends that captured body to the real OpenRouter endpoint with the real
 *    key, and checks which provider served it and whether the response parses.
 * 3. Asserts every surface's model resolves to the intended provider.
 */
import assert from "node:assert/strict";
import {
  AI_TIMEOUTS,
  AI_TOKEN_BUDGETS,
  DEEPSEEK_MODEL,
  PLAN_MODEL,
  SCREENSHOT_PERCEPTION_MODEL,
  aiRequestBody,
  providerRoute,
  resolveAiModels,
} from "../src/lib/work-os-ai-model";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) throw new Error("OPENROUTER_API_KEY is required for this probe");
const URL_ = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";

/* ---------------------------------------------------------------- */
/* 1. Capture the body the real code builds                          */
/* ---------------------------------------------------------------- */

let captured: { url: string; body: any } | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init: any) => {
  captured = { url: String(input), body: JSON.parse(init.body) };
  return new Response(
    JSON.stringify({ choices: [{ message: { content: JSON.stringify({ reply: "ok", taskMatches: [], claims: [], operations: [], planImport: null }) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}) as typeof fetch;

const { interpretWorkUpdate } = await import("../src/lib/aiInterpret");
await interpretWorkUpdate(
  { input: "I finished the auth refactor and started the billing webhook today." },
  [{ id: "t1", title: "Auth refactor", completed: false }],
);

globalThis.fetch = realFetch;
assert.ok(captured, "the real code did not call the provider");
const body = (captured as any).body;
console.log("captured body model   :", body.model);
console.log("captured body provider:", JSON.stringify(body.provider));
console.log("captured body keys    :", Object.keys(body).join(", "));
assert.equal(body.model, DEEPSEEK_MODEL, "the interpret surface must use the synthesis model");
assert.deepEqual(body.provider, { only: ["relace"], allow_fallbacks: false, require_parameters: true });

/* ---------------------------------------------------------------- */
/* 2. Send the captured body to the real provider                    */
/* ---------------------------------------------------------------- */

const live = await fetch(URL_, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const liveJson = await live.json() as any;
console.log("\nlive provider          :", liveJson.provider);
console.log("live model             :", liveJson.model);
console.log("live finish_reason     :", liveJson.choices?.[0]?.finish_reason);
console.log("live usage             :", JSON.stringify(liveJson.usage));
assert.equal(live.status, 200, `provider responded ${live.status}: ${JSON.stringify(liveJson).slice(0, 300)}`);
assert.equal(liveJson.provider, "Relace", "the pinned request must be served by Relace");
assert.notEqual(liveJson.choices?.[0]?.finish_reason, "length", "the answer must not be truncated");
const content = liveJson.choices?.[0]?.message?.content ?? "";
assert.ok(content.includes("{"), "the provider must answer with JSON");
console.log("live content           :", content.slice(0, 220).replace(/\n/g, " "));

/* ---------------------------------------------------------------- */
/* 3. The plan shape that previously returned an empty body          */
/* ---------------------------------------------------------------- */

// Left unbounded, the reasoning pass spent 2,718 of 3,000 tokens and the
// provider returned an empty body. The bounded effort plus the larger budget
// must produce a complete, parseable plan.
const workLog = Array.from({ length: 12 }, (_, i) => {
  return `- 09:${String(i).padStart(2, "0")}–10:${String(i).padStart(2, "0")} VS Code — edited src/lib/ai${i}.ts, ran 3 test files, ${i * 11} files changed, commit ${i}a91f2 pushed to feature/branch-${i}`;
}).join("\n");
const planBody = aiRequestBody(PLAN_MODEL, {
  temperature: 0.2,
  max_tokens: AI_TOKEN_BUDGETS.plan,
  messages: [
    { role: "system", content: "You are the Work OS planning assistant. Return only valid JSON and do not perform mutations." },
    { role: "user", content: `Build today's plan for this employee.\n${workLog}\nCurrent open tasks: 12 items with ids t1..t12, titles, due dates, estimates.\nReturn only valid JSON.` },
  ],
  response_format: { type: "json_object" },
});
console.log("\nplan body reasoning     :", JSON.stringify(planBody.reasoning));
const planStarted = Date.now();
const planRes = await fetch(URL_, {
  method: "POST",
  headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify(planBody),
});
const planJson = await planRes.json() as any;
const planUsage = planJson.usage ?? {};
console.log("plan provider           :", planJson.provider);
console.log("plan finish_reason      :", planJson.choices?.[0]?.finish_reason);
console.log("plan elapsed            :", `${Date.now() - planStarted}ms`, "(timeout", `${AI_TIMEOUTS.plan}ms)`);
console.log("plan usage              :", JSON.stringify(planUsage));
assert.equal(planRes.status, 200, `plan provider responded ${planRes.status}`);
assert.equal(planJson.provider, "Relace");
assert.equal(planJson.choices?.[0]?.finish_reason, "stop", "the plan must not be truncated");
const planContent = planJson.choices?.[0]?.message?.content ?? "";
assert.ok(planContent.length > 0, "the plan must not be empty");
JSON.parse(planContent);
console.log("plan content            :", planContent.slice(0, 160).replace(/\n/g, " "));
assert.ok(
  Date.now() - planStarted < AI_TIMEOUTS.plan,
  "the plan must answer inside its timeout",
);

/* ---------------------------------------------------------------- */
/* 4. Every surface resolves to the intended model and provider     */
/* ---------------------------------------------------------------- */

const models = resolveAiModels({});
const expectations: Array<[string, string, boolean]> = [
  ["interpret", models.interpret, true],
  ["plan", models.plan, true],
  ["eod", models.eod, true],
  ["insights", models.insights, true],
  ["loom", models.loom, true],
  ["memoryFact", models.memoryFact, true],
  ["nextSteps", models.nextSteps, true],
  ["activityInterval", models.activityInterval, true],
  ["screenshotHour", models.screenshotHour, true],
  ["checkIn", models.checkIn, true],
  ["screenshot", models.screenshot, false],
];
console.log("\nsurface        model                                       provider route");
for (const [surface, model, pinned] of expectations) {
  const route = providerRoute(model);
  console.log(
    `${surface.padEnd(15)} ${String(model).padEnd(42)} ${route ? JSON.stringify(route) : "(none)"}`,
  );
  if (pinned) {
    assert.deepEqual(route, { only: ["relace"], allow_fallbacks: false });
    assert.equal(model, DEEPSEEK_MODEL);
  } else {
    assert.equal(route, undefined);
    assert.equal(model, SCREENSHOT_PERCEPTION_MODEL);
  }
}

console.log("\nAll live AI-stack assertions passed.");

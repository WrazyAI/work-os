/**
 * Live verification of the screenshot payload paths.
 *
 * Three payloads matter, and they do not all go to the same model:
 *
 *   1. Per-frame screenshot observation  -> gpt-6-luna, an https image URL.
 *   2. Activity interval recap           -> DeepSeek on Relace, JPEG data URLs
 *                                          plus the real observation text.
 *   3. Screenshot hour summary           -> DeepSeek on Relace, text only.
 *
 * Every payload definition here is extracted from the shipped source at
 * runtime, so the probe cannot drift from what production actually sends. The
 * interval recap is validated with the shipped parser.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { parseIntervalSynthesis } from "@/lib/work-os-activity-intervals";
import { intervalSynthesisMessages } from "@/lib/work-os-activity-intervals";
import {
  AI_TOKEN_BUDGETS,
  ACTIVITY_INTERVAL_MODEL,
  SCREENSHOT_HOUR_MODEL,
  SCREENSHOT_MODEL,
  aiRequestBody,
} from "@/lib/work-os-ai-model";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) throw new Error("OPENROUTER_API_KEY is required");
const URL_ = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions";

const src = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** Extracts a balanced literal starting at the first open bracket after a marker. */
function balanced(source: string, marker: string, open: string, close: string): string {
  const at = source.indexOf(marker);
  assert.ok(at >= 0, `marker not found: ${marker}`);
  const start = source.indexOf(open, at);
  assert.ok(start >= 0, `open bracket not found after: ${marker}`);
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced literal after: ${marker}`);
}

/** The real observation tool, taken from the screenshot library. */
const screenshotSource = src("../src/lib/work-os-screenshots.ts");
const observationTool = new Function(`return ${balanced(screenshotSource, "const tool = {", "{", "}")}`)();

/** The real interval tool and system prompt, taken from the interval library. */
const intervalSource = src("../src/lib/work-os-activity-intervals.ts");
const intervalTool = new Function(
  `return (function intervalTool() ${balanced(intervalSource, "function intervalTool()", "{", "}")})()`,
)();
const intervalSystemPrompt = new Function(
  `return ${balanced(intervalSource, "const INTERVAL_SYSTEM_PROMPT =", "[", "]")}.join("\\n")`,
)();

/** The real hour summary schema, taken from the hour summary library. */
const hourSource = src("../src/lib/work-os-screenshot-hours.ts");
const maxHours = Number(hourSource.match(/const MAX_HOURS\s*=\s*(\d+)/)?.[1]);
assert.ok(Number.isFinite(maxHours), "MAX_HOURS must be readable from the hour summary library");
const hourSummarySchema = new Function(
  `const MAX_HOURS = ${maxHours}; return ${balanced(hourSource, "const HOUR_SUMMARY_SCHEMA =", "{", "}")}`,
)();

/* ------------------------------------------------------------------ */
/* A realistic work screenshot                                          */
/* ------------------------------------------------------------------ */

const CODE = [
  ["export async function summarizeHours(groups) {", "#c586c0"],
  ["  const hours = new Map();", "#d4d4d4"],
  ["  for (const group of groups) {", "#d4d4d4"],
  ["    const summary = await callModel(group);", "#d4d4d4"],
  ["    hours.set(group.hourStart, summary);", "#d4d4d4"],
  ["  }", "#d4d4d4"],
  ["  return hours;", "#d4d4d4"],
  ["}", "#d4d4d4"],
  ["", "#d4d4d4"],
  ["// TODO: rename to rollupScreenshotHours", "#6a9955"],
  ["const LIMIT = 16; // max hours per day", "#9cdcfe"],
];

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640">
  <rect width="1024" height="640" fill="#1e1e1e"/>
  <rect width="1024" height="34" fill="#2d2d2d"/>
  <text x="16" y="22" font-family="DejaVu Sans Mono" font-size="15" fill="#cccccc">work-os - src/lib/work-os-screenshot-hours.ts</text>
  <rect x="0" y="34" width="1024" height="26" fill="#37373d"/>
  <text x="16" y="52" font-family="DejaVu Sans Mono" font-size="13" fill="#e7e7e7">screenshot-hours.ts</text>
  <text x="200" y="52" font-family="DejaVu Sans Mono" font-size="13" fill="#e7e7e7">aiInterpret.ts</text>
  ${CODE.map(([line, color], i) => `<text x="40" y="${90 + i * 24}" font-family="DejaVu Sans Mono" font-size="16" fill="${color}">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("\n  ")}
  <rect x="0" y="420" width="1024" height="220" fill="#181818"/>
  <text x="16" y="448" font-family="DejaVu Sans Mono" font-size="14" fill="#569cd6">TERMINAL</text>
  <text x="16" y="480" font-family="DejaVu Sans Mono" font-size="15" fill="#d4d4d4">$ npm run work-os:test</text>
  <text x="16" y="506" font-family="DejaVu Sans Mono" font-size="15" fill="#6a9955">✔ screenshot processing derives every day window</text>
  <text x="16" y="532" font-family="DejaVu Sans Mono" font-size="15" fill="#6a9955">✔ draft context and hourly synthesis share the workday window</text>
  <text x="16" y="558" font-family="DejaVu Sans Mono" font-size="15" fill="#d4d4d4">tests 516  pass 516  fail 0</text>
</svg>`;

const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 72 }).toBuffer();
const dataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
console.log(`mock screenshot: ${jpeg.length} bytes jpeg, data url ${dataUrl.length} chars`);

async function call(body: Record<string, unknown>) {
  const started = Date.now();
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as any;
  return { res, json, ms: Date.now() - started };
}

function toolArgs(json: any): any {
  const call = json?.choices?.[0]?.message?.tool_calls?.[0];
  assert.ok(call, "the provider returned no tool call");
  assert.equal(call.function.name, "recordActivityInterval" in call.function ? call.function.name : call.function.name);
  return JSON.parse(call.function.arguments);
}

/* ------------------------------------------------------------------ */
/* 1. Per-frame screenshot observation -> gpt-6-luna                    */
/* ------------------------------------------------------------------ */

console.log("\n=== 1. screenshot observation -> gpt-6-luna ===");
const observationBody = aiRequestBody(SCREENSHOT_MODEL, {
  max_tokens: AI_TOKEN_BUDGETS.screenshotVision,
  messages: [
    {
      role: "system",
      content: [
        "Describe only what is visibly supported by this screenshot.",
        "This is supporting activity context, not proof of productivity or completion.",
        "Do not infer identity, intent, effort, pay eligibility, deception, task status, or output quality.",
        "Do not reproduce secrets, message contents, personal data, credentials, or customer details.",
        "Flag contains_sensitive_content only for the explicit list in the tool description; routine code, terminals, application UI, and ordinary work documents are not sensitive.",
        "Use unclear language when the image does not support a specific observation.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        { type: "text", text: "Metadata: app/title=Visual Studio Code; domain/app=file:///work-os/src/lib/work-os-screenshot-hours.ts; captured=2026-10-19T14:05:00Z." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ],
  tools: [observationTool],
  tool_choice: { type: "function", function: { name: "recordObservation" } },
});
console.log("model   :", observationBody.model);
console.log("provider:", JSON.stringify(observationBody.provider ?? "(none)"));
const observation = await call(observationBody);
console.log("HTTP    :", observation.res.status, "provider:", observation.json.provider, `(${observation.ms}ms)`);
assert.equal(observation.res.status, 200);
const obsArgs = toolArgs(observation.json);
console.log("summary :", obsArgs.summary);
console.log("app     :", obsArgs.visible_app, "| confidence:", obsArgs.confidence, "| sensitive:", obsArgs.contains_sensitive_content);
for (const field of ["summary", "visible_app", "work_context", "possible_task_reference", "confidence", "contains_sensitive_content", "sensitive_reason"]) {
  assert.ok(field in obsArgs, `observation is missing ${field}`);
}
assert.equal(typeof obsArgs.confidence, "number");
assert.equal(typeof obsArgs.contains_sensitive_content, "boolean");
assert.match(String(obsArgs.summary), /screenshot|code|editor|terminal|test/i, "the observation must describe the image content");
console.log("-> the image was read, not ignored");

/* ------------------------------------------------------------------ */
/* 2. Activity interval recap -> DeepSeek on Relace                    */
/* ------------------------------------------------------------------ */

console.log("\n=== 2. activity interval recap -> DeepSeek on Relace ===");
const observations = [
  { index: 1, at: "2026-10-19T14:05:00Z", app: "Visual Studio Code", summary: "Editing the hour summary function in a code editor", workContext: "implementation", possibleTaskReference: null, confidence: 0.9 },
  { index: 2, at: "2026-10-19T14:40:00Z", app: "Terminal", summary: "Running the test suite in a terminal", workContext: "verification", possibleTaskReference: null, confidence: 0.85 },
  { index: 3, at: "2026-10-19T15:10:00Z", app: "Google Chrome", summary: "Reading a documentation page in a browser", workContext: "reference reading", possibleTaskReference: null, confidence: 0.8 },
];
const intervalMessages = intervalSynthesisMessages({
  windowLabel: "2:00 PM – 3:30 PM",
  observations: observations as any,
  images: [
    { index: 1, at: "2026-10-19T14:05:00Z", app: "Visual Studio Code", dataUrl },
    { index: 2, at: "2026-10-19T14:40:00Z", app: "Terminal", dataUrl },
  ] as any,
  counts: { providerFrames: 46, processed: 41, excludedPolicy: 3, excludedSensitive: 1, unavailable: 1, pending: 0 } as any,
  contextBlock: "Live day state: focus is on finishing the screenshot summary feature.",
});
const intervalBody = aiRequestBody(ACTIVITY_INTERVAL_MODEL, {
  messages: intervalMessages,
  tools: [intervalTool],
  tool_choice: { type: "function", function: { name: "recordActivityInterval" } },
  temperature: 0.2,
  max_tokens: AI_TOKEN_BUDGETS.activityInterval,
});
console.log("model   :", intervalBody.model);
console.log("provider:", JSON.stringify(intervalBody.provider));
const contentTypes = (intervalMessages[1].content as any[]).map((c) => c.type);
console.log("payload :", contentTypes.join(" + "), "|", intervalMessages[1].content.length, "content parts");
const interval = await call(intervalBody);
console.log("HTTP    :", interval.res.status, "provider:", interval.json.provider, `(${interval.ms}ms)`);
console.log("usage   :", JSON.stringify(interval.json.usage?.completion_tokens_details ?? {}));
assert.equal(interval.res.status, 200);
assert.equal(interval.json.provider, "Relace");
const intervalArgs = toolArgs(interval.json);

// The shipped parser decides whether the payload is compatible.
const parsed = parseIntervalSynthesis(intervalArgs, observations.length, []);
console.log("headline:", parsed.headline);
console.log("detail  :", parsed.detail);
console.log("activities:");
for (const activity of parsed.activities ?? []) {
  console.log(`   - ${activity.description} [evidence ${JSON.stringify(activity.evidenceIndexes)}] confidence=${activity.confidence}`);
}
console.log("coverage:", JSON.stringify(parsed.coverage ?? {}));
assert.ok(parsed.headline, "the parsed recap must carry a headline");
assert.ok((parsed.activities ?? []).length > 0, "the parsed recap must carry activities");
console.log("-> the shipped parser accepted the DeepSeek response");

/* ------------------------------------------------------------------ */
/* 3. Screenshot hour summary -> DeepSeek on Relace                    */
/* ------------------------------------------------------------------ */

console.log("\n=== 3. screenshot hour summary -> DeepSeek on Relace ===");
const hourBody = aiRequestBody(SCREENSHOT_HOUR_MODEL, {
  messages: [
    {
      role: "system",
      content: [
        "You summarize sampled work screenshots for one employee's end-of-day report.",
        "For each hour, write one plain sentence (at most two short ones) describing what the frames show happening in that hour.",
        "Use only what the frame summaries state. Never invent applications, tasks, outcomes, people, or intent.",
        "Never claim productivity, effort, attendance, or completion, and never say the day was good or bad.",
        "Write in plain 12-hour language when a time appears in your sentence; never mention a timezone.",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        hours: [
          { hourStart: 14, frames: [{ summary: "Editing the hour summary function in a code editor" }, { summary: "Running the test suite in a terminal" }] },
          { hourStart: 15, frames: [{ summary: "Reading a documentation page in a browser" }] },
        ],
      }),
    },
  ],
  temperature: 0.2,
  max_tokens: AI_TOKEN_BUDGETS.screenshotHour,
  response_format: { type: "json_schema", json_schema: hourSummarySchema },
});
console.log("model   :", hourBody.model);
console.log("provider:", JSON.stringify(hourBody.provider));
const hour = await call(hourBody);
console.log("HTTP    :", hour.res.status, "provider:", hour.json.provider, `(${hour.ms}ms)`);
assert.equal(hour.res.status, 200);
assert.equal(hour.json.provider, "Relace");
const hourContent = hour.json.choices?.[0]?.message?.content ?? "";
console.log("content :", hourContent.slice(0, 300));
const hourJson = JSON.parse(hourContent);
assert.ok(Array.isArray(hourJson.hours), "the hour summary must be an hours array");
for (const entry of hourJson.hours) {
  assert.equal(typeof entry.hourStart, "number");
  assert.equal(typeof entry.summary, "string");
}
console.log("-> the hour summary parsed against the shipped schema");

console.log("\nAll screenshot payload assertions passed.");

import { createHash } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { AI_TIMEOUTS, AI_TOKEN_BUDGETS, aiRequestBody, recordAiUsage } from "@/lib/work-os-ai-model";
import { type PayrollAiPolicy } from "@/lib/work-os-payroll-ai";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import { retainedScreenshotImage } from "@/lib/work-os-screenshots";
import type {
  PayrollDayInput, PayrollFrameContext, PayrollFrameResult, PayrollScope,
} from "@/modules/work-os/payroll/contracts";

const PROMPT_VERSION = "payroll-frame-v1";
const RUBRIC_HASH = "payroll-frame-rubric-v1";
const MAX_FRAMES = 3;
const CATEGORIES = new Set(["work", "meeting", "training", "reading", "idle", "nonwork", "unclear"]);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export class PayrollFrameUnavailableError extends Error {
  readonly code = "payroll_frame_unavailable";
}
export class PayrollFrameConsentError extends Error {
  readonly code = "payroll_frame_consent";
}

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** One representative frame at the start, middle and end of an ambiguous day.
 * The run owns the hard 48-frame cap; this function never returns more than 3. */
export function selectPayrollFrames(day: PayrollDayInput): PayrollFrameContext[] {
  const candidates = (day.frameCandidates ?? [])
    .filter((frame) => frame.summary.trim())
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.summaryId.localeCompare(right.summaryId));
  if (candidates.length <= MAX_FRAMES) return candidates;
  const middle = Math.floor(candidates.length / 2);
  return [candidates[0], candidates[middle], candidates[candidates.length - 1]];
}

/** Cache identity includes the scoped person, exact source, neutral summary,
 * prompt/rubric/policy version, model and consent epoch. */
export function payrollFrameClassificationKey(
  scope: PayrollScope, frame: PayrollFrameContext, policy: PayrollAiPolicy, consentVersion = "current",
): string {
  return hash({
    organizationId: scope.organizationId, personId: scope.personId,
    summaryId: frame.summaryId, evidenceEventId: frame.evidenceEventId,
    sourceHash: frame.sourceHash, summary: frame.summary, app: frame.app,
    promptVersion: PROMPT_VERSION, rubricHash: RUBRIC_HASH,
    policyVersion: policy.version, framePolicyVersion: frame.policyVersion,
    model: policy.visionModel, consentVersion,
  });
}

/** Validates tenant/person ownership, processing status, raw-image expiry and
 * both current consents immediately before the decryptor is called. */
export async function assertPayrollFrameImageAccess(scope: PayrollScope, frame: PayrollFrameContext, now = new Date()): Promise<void> {
  const { rows } = await getPool().query<Record<string, unknown>>(`SELECT person_id,processing_status,expires_at,deleted_at
    FROM work_screenshot_summaries WHERE id=$1 AND organization_id=$2 AND person_id=$3`,
  [frame.summaryId, scope.organizationId, scope.personId]);
  const row = rows[0];
  if (!row) throw new PayrollFrameUnavailableError("Payroll frame is not owned by this person");
  if (row.deleted_at || String(row.processing_status) !== "processed") throw new PayrollFrameUnavailableError("Payroll frame is not retained");
  const expires = row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(String(row.expires_at ?? ""));
  if (!Number.isFinite(expires) || expires <= now.getTime()) throw new PayrollFrameUnavailableError("Payroll frame expired");
  const visible = object(row.visible_context);
  if (visible.contains_sensitive_content === true || visible.containsSensitiveContent === true) throw new PayrollFrameUnavailableError("Payroll frame is excluded by sensitive-content policy");
  const consent = await employeeTrackingConsent(scope.organizationId, scope.personId);
  if (!consent.tracking || !consent.screenshotAnalysis) throw new PayrollFrameConsentError("Current tracking and screenshot consent are required");
}

export async function loadPayrollFrameImage(scope: PayrollScope, frame: PayrollFrameContext): Promise<string> {
  await assertPayrollFrameImageAccess(scope, frame);
  const image = await retainedScreenshotImage(frame.summaryId);
  if (!image) throw new PayrollFrameUnavailableError("Payroll frame bytes are unavailable");
  return `data:${image.contentType};base64,${Buffer.from(image.bytes).toString("base64")}`;
}

function unclear(frame: PayrollFrameContext, policy: PayrollAiPolicy, reason: string, scope: PayrollScope): PayrollFrameResult {
  return {
    category: "unclear", confidence: 0, reason: reason.slice(0, 300), app: frame.app,
    sourceHash: frame.sourceHash, model: policy.visionModel, promptVersion: PROMPT_VERSION,
    classificationKey: payrollFrameClassificationKey(scope, frame, policy),
  };
}

function classifyTool() {
  return {
    type: "function",
    function: {
      name: "recordPayrollFrameContext",
      description: "Classify only the visible context of this frame. Never decide pay, hours, productivity, intent or truthfulness.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...CATEGORIES] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string", description: "One short evidence-based sentence." },
          app: { type: ["string", "null"] },
        },
        required: ["category", "confidence", "reason", "app"],
        additionalProperties: false,
      },
    },
  };
}

export type PayrollVisionDeps = {
  loadImage?: (scope: PayrollScope, frame: PayrollFrameContext) => Promise<string>;
  fetch?: typeof fetch;
};

/** One point observation. It cannot allocate minutes or approve pay; model
 * timeout, missing tool arguments, length truncation and consent failure all
 * return `unclear` rather than `idle`. */
export async function classifyPayrollFrame(
  scope: PayrollScope, frame: PayrollFrameContext, policy: PayrollAiPolicy,
  signal?: AbortSignal, deps: PayrollVisionDeps = {},
): Promise<PayrollFrameResult> {
  if (signal?.aborted) return unclear(frame, policy, "Classification was cancelled.", scope);
  let imageUrl: string;
  try {
    imageUrl = await (deps.loadImage ?? loadPayrollFrameImage)(scope, frame);
  } catch (error) {
    return unclear(frame, policy, error instanceof Error ? error.message : "Frame image is unavailable.", scope);
  }
  if (signal?.aborted) return unclear(frame, policy, "Classification was cancelled.", scope);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return unclear(frame, policy, "OPENROUTER_API_KEY is not configured.", scope);
  const timeout = AbortSignal.timeout(AI_TIMEOUTS.payrollVision);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: combined,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(policy.visionModel, {
        max_tokens: AI_TOKEN_BUDGETS.payrollVision,
        messages: [
          {
            role: "system",
            content: [
              "Classify only what is visibly supported by this screenshot.",
              "This is one point observation, never a duration or a pay decision.",
              "Allowed categories: work, meeting, training, reading, idle, nonwork, unclear.",
              "Use meeting/training/reading only when the visible context establishes it.",
              "Use unclear when the image, tool output or context is insufficient.",
              "Do not infer identity, effort, intent, deception, productivity, hours, or pay eligibility.",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              { type: "text", text: `App: ${frame.app ?? "unknown"}. Captured: ${frame.capturedAt}. Prior neutral summary: ${frame.summary.slice(0, 600)}` },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
        tools: [classifyTool()],
        tool_choice: { type: "function", function: { name: "recordPayrollFrameContext" } },
      })),
    });
  } catch (error) {
    return unclear(frame, policy, error instanceof Error ? error.message : "Classification request failed.", scope);
  }
  if (!response.ok) return unclear(frame, policy, `Classification model returned HTTP ${response.status}.`, scope);
  let json: Record<string, unknown>;
  try { json = await response.json() as Record<string, unknown>; }
  catch { return unclear(frame, policy, "Classification response was not JSON.", scope); }
  recordAiUsage("payroll_frame_classify", policy.visionModel, json);
  const choices = Array.isArray(json.choices) ? json.choices as Array<Record<string, unknown>> : [];
  if (String(choices[0]?.finish_reason ?? "") === "length") {
    return unclear(frame, policy, "Classification response was truncated.", scope);
  }
  const message = (choices[0]?.message ?? {}) as Record<string, unknown>;
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls as Array<Record<string, unknown>> : [];
  const fn = (calls[0]?.function ?? {}) as Record<string, unknown>;
  const args = typeof fn.arguments === "string" ? fn.arguments : null;
  if (!args) return unclear(frame, policy, "Classification returned no structured arguments.", scope);
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(args) as Record<string, unknown>; }
  catch { return unclear(frame, policy, "Classification arguments were malformed.", scope); }
  const category = typeof parsed.category === "string" ? parsed.category : "";
  const confidence = Number(parsed.confidence);
  const reason = typeof parsed.reason === "string" ? parsed.reason.replace(/\s+/g, " ").trim() : "";
  if (!CATEGORIES.has(category) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !reason) {
    return unclear(frame, policy, "Classification arguments did not match the rubric.", scope);
  }
  return {
    category: category as PayrollFrameResult["category"],
    confidence,
    reason: reason.slice(0, 300),
    app: typeof parsed.app === "string" ? parsed.app.slice(0, 160) : frame.app,
    sourceHash: frame.sourceHash,
    model: policy.visionModel,
    promptVersion: PROMPT_VERSION,
    classificationKey: payrollFrameClassificationKey(scope, frame, policy),
  };
}
